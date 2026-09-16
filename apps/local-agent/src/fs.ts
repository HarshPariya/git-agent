import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertWithinRoot, validateSafeRepoPath } from "./security.js";
import type { BrowseEntry, BrowseResponse } from "./types.js";

export async function browseDirectory(targetPath?: string): Promise<BrowseResponse> {
  const currentPath = targetPath ? path.resolve(targetPath.trim()) : os.homedir();
  const parentPath = path.dirname(currentPath) !== currentPath ? path.dirname(currentPath) : null;

  const entries: BrowseEntry[] = [];

  try {
    const dirEntries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const d of dirEntries) {
      if (!d.isDirectory()) continue;
      if (d.name.startsWith(".") && d.name !== ".git") continue;
      if (d.name === "node_modules" || d.name === "$RECYCLE.BIN") continue;

      const subPath = path.join(currentPath, d.name);
      let isGit = false;
      try {
        const gitStat = await fs.stat(path.join(subPath, ".git"));
        isGit = gitStat.isDirectory() || gitStat.isFile();
      } catch {
        // Not a git repository
      }

      entries.push({
        name: d.name,
        path: subPath,
        isDirectory: true,
        isGit,
      });
    }
  } catch (err: unknown) {
    throw new Error(`Cannot browse directory '${currentPath}': ${(err as Error).message}`, { cause: err });
  }

  // Sort: Git repos first, then alphabetically
  entries.sort((a, b) => {
    if (a.isGit && !b.isGit) return -1;
    if (!a.isGit && b.isGit) return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    currentPath,
    parentPath,
    entries,
  };
}

export async function readFileContent(
  rawRepoPath: string,
  filePath: string,
): Promise<{ filePath: string; content: string; size: number }> {
  const repoPath = validateSafeRepoPath(rawRepoPath);
  const fullPath = assertWithinRoot(path.join(repoPath, filePath), repoPath);

  const stat = await fs.stat(fullPath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error(`File '${filePath}' exceeds 5MB limit`);
  }

  const content = await fs.readFile(fullPath, "utf-8");
  return { filePath, content, size: stat.size };
}

export async function writeFileContent(
  rawRepoPath: string,
  filePath: string,
  content: string,
): Promise<{ filePath: string; size: number }> {
  const repoPath = validateSafeRepoPath(rawRepoPath);
  const fullPath = assertWithinRoot(path.join(repoPath, filePath), repoPath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, content, "utf-8");

  const stat = await fs.stat(fullPath);
  return { filePath, size: stat.size };
}
