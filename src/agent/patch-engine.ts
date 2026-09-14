import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface PatchFileChange {
  readonly filePath: string;
  readonly originalContent: string;
  readonly newContent: string;
  readonly explanation?: string;
}

export interface PatchBackup {
  readonly id: string;
  readonly repositoryPath: string;
  readonly timestamp: string;
  readonly files: ReadonlyMap<string, string>;
  readonly description: string;
}

export interface PatchResult {
  readonly success: boolean;
  readonly backupId?: string;
  readonly appliedFiles: readonly string[];
  readonly diff: string;
  readonly error?: string;
}

export interface RevertResult {
  readonly success: boolean;
  readonly restoredFiles: readonly string[];
  readonly error?: string;
}

const backupStore = new Map<string, PatchBackup>();

const generateId = (): string => `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export function validatePrePatch(
  repoPath: string,
  changes: readonly { filePath: string }[],
): { valid: boolean; errors: string[] } {
  const resolvedRepo = path.resolve(repoPath);
  const errors = changes
    .map((change) => {
      const fullPath = path.resolve(repoPath, change.filePath);
      return fullPath.startsWith(resolvedRepo) ? null : `File path traverses outside repository: ${change.filePath}`;
    })
    .filter((error): error is string => error !== null);

  return { valid: errors.length === 0, errors };
}

export async function createPatchBackup(
  repoPath: string,
  filePaths: readonly string[],
  description = "Pre-patch backup",
): Promise<PatchBackup> {
  const backupId = generateId();
  const filesMap = new Map<string, string>();

  await Promise.all(
    filePaths.map(async (relPath) => {
      try {
        const content = await fs.readFile(path.resolve(repoPath, relPath), "utf-8");
        filesMap.set(relPath, content);
      } catch (err: unknown) {
        if (isEnoentError(err)) {
          filesMap.set(relPath, "");
          return;
        }
        throw err;
      }
    }),
  );

  const backup: PatchBackup = {
    id: backupId,
    repositoryPath: repoPath,
    timestamp: new Date().toISOString(),
    files: filesMap,
    description,
  };

  backupStore.set(backupId, backup);
  return backup;
}

export async function applyPatch(
  repoPath: string,
  changes: readonly PatchFileChange[],
  description = "Agent Fix Patch",
): Promise<PatchResult> {
  const validation = validatePrePatch(repoPath, changes);
  if (!validation.valid) {
    return {
      success: false,
      appliedFiles: [],
      diff: "",
      error: `Pre-patch validation failed: ${validation.errors.join("; ")}`,
    };
  }

  const filePaths = changes.map((c) => c.filePath);
  const backup = await createPatchBackup(repoPath, filePaths, description);
  const appliedFiles: string[] = [];
  const diffParts: string[] = [];

  try {
    for (const change of changes) {
      const fullPath = path.resolve(repoPath, change.filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, change.newContent, "utf-8");
      appliedFiles.push(change.filePath);
      diffParts.push(generateDiffHunk(change.filePath, change.originalContent, change.newContent));
    }

    const gitDiff = await getGitDiff(repoPath);
    return {
      success: true,
      backupId: backup.id,
      appliedFiles,
      diff: gitDiff || diffParts.join("\n"),
    };
  } catch (err: unknown) {
    await revertPatch(backup.id);
    return {
      success: false,
      appliedFiles: [],
      diff: "",
      error: `Failed to apply patch: ${err instanceof Error ? err.message : String(err)}. Automatically rolled back.`,
    };
  }
}

function generateDiffHunk(filePath: string, originalContent: string, newContent: string): string {
  const origLines = originalContent.split("\n");
  const newLines = newContent.split("\n");
  const diffLines = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${origLines.length} +1,${newLines.length} @@`,
    ...origLines.map((l) => `-${l}`),
    ...newLines.map((l) => `+${l}`),
  ];
  return diffLines.join("\n");
}

async function getGitDiff(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execAsync("git diff", { cwd: repoPath, timeout: 10_000 });
    return stdout;
  } catch {
    return "";
  }
}

export async function revertPatch(backupId: string): Promise<RevertResult> {
  const backup = backupStore.get(backupId);
  if (!backup) {
    return { success: false, restoredFiles: [], error: `Backup ${backupId} not found in store` };
  }

  const restoredFiles: string[] = [];

  try {
    for (const [relPath, originalContent] of backup.files.entries()) {
      const fullPath = path.resolve(backup.repositoryPath, relPath);

      if (originalContent === "") {
        await deleteFileIfExists(fullPath);
        restoredFiles.push(relPath);
        continue;
      }

      await fs.writeFile(fullPath, originalContent, "utf-8");
      restoredFiles.push(relPath);
    }

    backupStore.delete(backupId);
    return { success: true, restoredFiles };
  } catch (err: unknown) {
    return {
      success: false,
      restoredFiles,
      error: `Revert failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function deleteFileIfExists(fullPath: string): Promise<void> {
  try {
    await fs.unlink(fullPath);
  } catch {
    // File doesn't exist, which is fine for deletion
  }
}

export function getBackup(backupId: string): PatchBackup | undefined {
  return backupStore.get(backupId);
}

export function listBackups(): readonly PatchBackup[] {
  return Array.from(backupStore.values());
}

export function applyDiffHunk(original: string, patch: string): string {
  if (!patch || !original) {
    return patch || original;
  }

  const { minusLines, plusLines } = parseDiffLines(patch);
  if (minusLines.length === 0 || plusLines.length === 0) {
    return hasNoDiffMarkers(patch) ? patch : original;
  }

  return applyLineReplacements(original, minusLines, plusLines);
}

function parseDiffLines(patch: string): { minusLines: string[]; plusLines: string[] } {
  const lines = patch.split("\n");
  return {
    minusLines: lines
      .filter((l) => l.startsWith("-") && !l.startsWith("---"))
      .map((l) => l.slice(1).trim())
      .filter(Boolean),
    plusLines: lines
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
      .map((l) => l.slice(1))
      .filter(Boolean),
  };
}

function hasNoDiffMarkers(patch: string): boolean {
  return !patch.split("\n").some((l) => l.startsWith("+") || l.startsWith("-"));
}

function applyLineReplacements(original: string, minusLines: string[], plusLines: string[]): string {
  let result = original;
  for (let i = 0; i < minusLines.length; i++) {
    const target = minusLines[i]!;
    const replacement = plusLines[i] ?? "";
    if (target && result.includes(target)) {
      result = result.replace(target, replacement);
    }
  }
  return result;
}

function isEnoentError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}
