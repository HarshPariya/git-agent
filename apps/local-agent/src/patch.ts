import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertWithinRoot, validateSafeRepoPath } from "./security.js";
import type { PatchApplyResult, PatchChange, PatchRevertResult } from "./types.js";

interface BackupMetadata {
  backupId: string;
  repoPath: string;
  createdAt: string;
  files: Array<{ relativePath: string; existed: boolean }>;
}

export async function applyPatchChanges(rawRepoPath: string, changes: PatchChange[]): Promise<PatchApplyResult> {
  const repoPath = validateSafeRepoPath(rawRepoPath);
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("Changes array cannot be empty");
  }

  const backupId = crypto.randomUUID();
  const backupDir = path.join(os.homedir(), ".git-agent", "backups", backupId);
  await fs.mkdir(backupDir, { recursive: true });

  const backupMeta: BackupMetadata = {
    backupId,
    repoPath,
    createdAt: new Date().toISOString(),
    files: [],
  };

  const modifiedFiles: string[] = [];

  try {
    // 1. Snapshot original file state before modifying anything
    for (const change of changes) {
      const fullPath = assertWithinRoot(path.join(repoPath, change.filePath), repoPath);
      const relPath = path.relative(repoPath, fullPath).replace(/\\/g, "/");
      const backupFilePath = path.join(backupDir, relPath);

      let existed = false;
      try {
        const originalContent = await fs.readFile(fullPath, "utf-8");
        existed = true;
        await fs.mkdir(path.dirname(backupFilePath), { recursive: true });
        await fs.writeFile(backupFilePath, originalContent, "utf-8");
      } catch {
        // File did not exist originally
      }

      backupMeta.files.push({ relativePath: relPath, existed });
    }

    // Save backup metadata
    await fs.writeFile(path.join(backupDir, "meta.json"), JSON.stringify(backupMeta, null, 2), "utf-8");

    // 2. Apply modifications
    for (const change of changes) {
      const fullPath = assertWithinRoot(path.join(repoPath, change.filePath), repoPath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, change.content, "utf-8");
      modifiedFiles.push(change.filePath);
    }

    return {
      success: true,
      backupId,
      modifiedFiles,
    };
  } catch (err: unknown) {
    const errorObj = err as Error;
    // Attempt cleanup/rollback on failure
    await revertPatchBackup(rawRepoPath, backupId).catch(() => {});
    return {
      success: false,
      backupId,
      modifiedFiles: [],
      error: errorObj.message,
    };
  }
}

export async function revertPatchBackup(rawRepoPath: string, backupId: string): Promise<PatchRevertResult> {
  const repoPath = validateSafeRepoPath(rawRepoPath);
  const backupDir = path.join(os.homedir(), ".git-agent", "backups", backupId);

  const metaRaw = await fs.readFile(path.join(backupDir, "meta.json"), "utf-8");
  const meta = JSON.parse(metaRaw) as BackupMetadata;

  const restoredFiles: string[] = [];

  for (const item of meta.files) {
    const fullTarget = assertWithinRoot(path.join(repoPath, item.relativePath), repoPath);

    if (item.existed) {
      const backupFile = path.join(backupDir, item.relativePath);
      const original = await fs.readFile(backupFile, "utf-8");
      await fs.mkdir(path.dirname(fullTarget), { recursive: true });
      await fs.writeFile(fullTarget, original, "utf-8");
      restoredFiles.push(item.relativePath);
    } else {
      // File was newly created by patch — delete it
      await fs.unlink(fullTarget).catch(() => {});
      restoredFiles.push(item.relativePath);
    }
  }

  return {
    success: true,
    restoredFiles,
  };
}
