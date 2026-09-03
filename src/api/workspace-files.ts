import type { Request, Response } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeWorkspacePath } from "../tools/workspace-path.js";

const IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".cache",
  ".turbo",
  ".next",
  "package-lock.zip",
]);

interface TreeEntry {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  size?: number;
}

const scanTree = async (
  baseDir: string,
  targetDir: string,
  maxDepth: number = 4,
  currentDepth: number = 0,
): Promise<TreeEntry[]> => {
  if (currentDepth > maxDepth) return [];
  const entries: TreeEntry[] = [];

  try {
    const dirEntries = await fs.readdir(targetDir, { withFileTypes: true });

    // Sort directories first, then alphabetically
    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of sorted) {
      if (IGNORED_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith(".env")) continue; // protect secret env files

      const fullPath = path.join(targetDir, entry.name);
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        entries.push({
          name: entry.name,
          relativePath,
          type: "directory",
        });
        const nested = await scanTree(baseDir, fullPath, maxDepth, currentDepth + 1);
        entries.push(...nested);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          entries.push({
            name: entry.name,
            relativePath,
            type: "file",
            size: stat.size,
          });
        } catch {
          entries.push({
            name: entry.name,
            relativePath,
            type: "file",
          });
        }
      }
    }
  } catch {
    // Directory unreadable or permission issue
  }

  return entries;
};

export const getWorkspaceTreeHandler = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const rootDir = process.cwd();
    const workspaceName = path.basename(rootDir);
    const entries = await scanTree(rootDir, rootDir);

    res.status(200).json({
      success: true,
      workspaceName,
      rootPath: rootDir.replace(/\\/g, "/"),
      entries,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

export const readWorkspaceFileHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const filePath = typeof req.query.path === "string" ? req.query.path : "";
    if (!filePath) {
      res.status(400).json({ success: false, error: "Missing required query parameter: path" });
      return;
    }

    const resolved = sanitizeWorkspacePath(process.cwd(), filePath, "read");
    const content = await fs.readFile(resolved, "utf-8");

    res.status(200).json({
      success: true,
      path: filePath.replace(/\\/g, "/"),
      content,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ success: false, error: message });
  }
};

export const writeWorkspaceFileHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { path: reqPath, content } = req.body as { path?: string; content?: string };
    if (!reqPath || typeof reqPath !== "string") {
      res.status(400).json({ success: false, error: "Missing required body parameter: path" });
      return;
    }

    const resolved = path.resolve(process.cwd(), reqPath);
    const relative = path.relative(process.cwd(), resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.status(403).json({ success: false, error: "Access denied: path escapes workspace root" });
      return;
    }

    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, typeof content === "string" ? content : "", "utf-8");

    res.status(200).json({
      success: true,
      path: reqPath.replace(/\\/g, "/"),
      message: `File written successfully: ${reqPath}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

export const createWorkspaceFolderHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { path: reqPath } = req.body as { path?: string };
    if (!reqPath || typeof reqPath !== "string") {
      res.status(400).json({ success: false, error: "Missing required body parameter: path" });
      return;
    }

    const resolved = path.resolve(process.cwd(), reqPath);
    const relative = path.relative(process.cwd(), resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.status(403).json({ success: false, error: "Access denied: path escapes workspace root" });
      return;
    }

    await fs.mkdir(resolved, { recursive: true });

    res.status(200).json({
      success: true,
      path: reqPath.replace(/\\/g, "/"),
      message: `Directory created: ${reqPath}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};

export const deleteWorkspaceFileHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { path: reqPath } = req.body as { path?: string };
    if (!reqPath || typeof reqPath !== "string") {
      res.status(400).json({ success: false, error: "Missing required body parameter: path" });
      return;
    }

    const resolved = sanitizeWorkspacePath(process.cwd(), reqPath, "delete");
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rmdir(resolved);
    } else {
      await fs.unlink(resolved);
    }

    res.status(200).json({
      success: true,
      path: reqPath.replace(/\\/g, "/"),
      message: `Deleted successfully: ${reqPath}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: message });
  }
};
