import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);

export interface PatchFileChange { readonly filePath: string; readonly originalContent: string; readonly newContent: string; readonly explanation?: string; }
export interface PatchBackup { readonly id: string; readonly repositoryPath: string; readonly timestamp: string; readonly files: ReadonlyMap<string, string>; readonly description: string; }
export interface PatchResult { readonly success: boolean; readonly backupId?: string; readonly appliedFiles: readonly string[]; readonly diff: string; readonly error?: string; }
export interface RevertResult { readonly success: boolean; readonly restoredFiles: readonly string[]; readonly error?: string; }

const backupStore = new Map<string, PatchBackup>();
function generateId(): string { return `patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

export async function validatePrePatch(repoPath: string, changes: readonly { filePath: string }[]): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = []; const resolvedRepo = path.resolve(repoPath);
  for (const change of changes) { const fullPath = path.resolve(repoPath, change.filePath); if (!fullPath.startsWith(resolvedRepo)) errors.push(`File path traverses outside repository: ${change.filePath}`); }
  return { valid: errors.length === 0, errors };
}

export async function createPatchBackup(repoPath: string, filePaths: readonly string[], description = "Pre-patch backup"): Promise<PatchBackup> {
  const backupId = generateId(); const filesMap = new Map<string, string>();
  for (const relPath of filePaths) { const fullPath = path.resolve(repoPath, relPath); try { filesMap.set(relPath, await fs.readFile(fullPath, "utf-8")); } catch (err: any) { if (err.code === "ENOENT") filesMap.set(relPath, ""); else throw err; } }
  const backup: PatchBackup = { id: backupId, repositoryPath: repoPath, timestamp: new Date().toISOString(), files: filesMap, description };
  backupStore.set(backupId, backup); return backup;
}

export async function applyPatch(repoPath: string, changes: readonly PatchFileChange[], description = "Agent Fix Patch"): Promise<PatchResult> {
  const validation = await validatePrePatch(repoPath, changes); if (!validation.valid) return { success: false, appliedFiles: [], diff: "", error: `Pre-patch validation failed: ${validation.errors.join("; ")}` };
  const filePaths = changes.map((c) => c.filePath); const backup = await createPatchBackup(repoPath, filePaths, description);
  const appliedFiles: string[] = []; const diffParts: string[] = [];
  try {
    for (const change of changes) { const fullPath = path.resolve(repoPath, change.filePath); await fs.mkdir(path.dirname(fullPath), { recursive: true }); await fs.writeFile(fullPath, change.newContent, "utf-8"); appliedFiles.push(change.filePath); diffParts.push(`--- a/${change.filePath}\n+++ b/${change.filePath}`); const origLines = change.originalContent.split("\n"); const newLines = change.newContent.split("\n"); diffParts.push(`@@ -1,${origLines.length} +1,${newLines.length} @@`); origLines.forEach((l) => diffParts.push(`-${l}`)); newLines.forEach((l) => diffParts.push(`+${l}`)); }
    let gitDiff = ""; try { const { stdout } = await execAsync("git diff", { cwd: repoPath, timeout: 10_000 }); gitDiff = stdout; } catch { gitDiff = diffParts.join("\n"); }
    return { success: true, backupId: backup.id, appliedFiles, diff: gitDiff || diffParts.join("\n") };
  } catch (err: any) { await revertPatch(backup.id); return { success: false, appliedFiles: [], diff: "", error: `Failed to apply patch: ${err.message}. Automatically rolled back.` }; }
}

export async function revertPatch(backupId: string): Promise<RevertResult> {
  const backup = backupStore.get(backupId); if (!backup) return { success: false, restoredFiles: [], error: `Backup ${backupId} not found in store` };
  const restoredFiles: string[] = [];
  try { for (const [relPath, originalContent] of backup.files.entries()) { const fullPath = path.resolve(backup.repositoryPath, relPath); if (originalContent === "") { try { await fs.unlink(fullPath); restoredFiles.push(relPath); } catch { } } else { await fs.writeFile(fullPath, originalContent, "utf-8"); restoredFiles.push(relPath); } } backupStore.delete(backupId); return { success: true, restoredFiles }; } catch (err: any) { return { success: false, restoredFiles, error: `Revert failed: ${err.message}` }; }
}

export function getBackup(backupId: string): PatchBackup | undefined { return backupStore.get(backupId); }
export function listBackups(): readonly PatchBackup[] { return Array.from(backupStore.values()); }

export function applyDiffHunk(original: string, patch: string): string {
  if (!patch) return original; if (!original) return patch;
  const lines = patch.split("\n"); const minusLines = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).map((l) => l.slice(1).trim()).filter(Boolean); const plusLines = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).filter(Boolean);
  if (minusLines.length > 0 && plusLines.length > 0) { let result = original; for (let i = 0; i < minusLines.length; i++) { const target = minusLines[i]!; const replacement = plusLines[i] ?? ""; if (target && result.includes(target)) result = result.replace(target, replacement); } return result; }
  if (!lines.some((l) => l.startsWith("+") || l.startsWith("-"))) return patch;
  return original;
}
