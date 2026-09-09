import type { NextFunction, Request, Response } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { getExecutionPath } from "../git/engine.js";
import { logger } from "../logging/logger.js";

export interface DirectoryItem { readonly name: string; readonly path: string; readonly isGitRepo: boolean; }
export interface FileItem { readonly name: string; readonly path: string; readonly ext: string; readonly sizeBytes: number; }
export interface BrowseResult { readonly currentPath: string; readonly parentPath: string | null; readonly isGitRepo: boolean; readonly directories: readonly DirectoryItem[]; readonly files: readonly FileItem[]; readonly shortcuts: readonly { name: string; path: string }[]; }
export interface ResolveFolderRequest { readonly folderName: string; readonly sampleFiles?: readonly string[]; readonly currentBrowsedPath?: string; }
export interface ResolveFolderResult { readonly resolvedPath: string | null; readonly folderName: string; readonly exists: boolean; readonly isGitRepo: boolean; readonly candidates: readonly string[]; }
export interface PickNativeDialogResult { readonly path?: string; readonly folderName?: string; readonly isGitRepo?: boolean; readonly cancelled: boolean; }

const SKIP_DIRS = new Set([".", "node_modules", "$RECYCLE.BIN", "dist", "build", ".cache"]);
const SKIP_FILES = new Set([".git", ".DS_Store", "Thumbs.db"]);
const BINARY_EXTS = [".exe", ".dll", ".so", ".dylib", ".bin", ".iso", ".zip", ".tar", ".gz", ".7z", ".png", ".jpg", ".jpeg", ".ico", ".webp", ".pdf"];

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? request.body as Record<string, unknown> : {};

const resolveTargetPath = (rawPath: string): string => {
  const homedir = os.homedir();
  if (!rawPath) {
    const workspaceParent = path.dirname(process.cwd());
    return fs.existsSync(workspaceParent) ? workspaceParent : process.cwd();
  }
  if (rawPath === "~" || rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
    return path.resolve(homedir, rawPath.replace(/^~[/\\]?/, ""));
  }
  if (rawPath.length === 2 && /^[a-zA-Z]:$/.test(rawPath)) return `${rawPath}\\`;
  return path.resolve(rawPath);
};

const statDirectory = async (targetPath: string): Promise<string> => {
  try {
    const stat = await fs.promises.stat(targetPath);
    return stat.isDirectory() ? targetPath : path.dirname(targetPath);
  } catch { return process.cwd(); }
};

const getAvailableDrives = (): readonly string[] => {
  if (process.platform !== "win32") return ["/"];
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const drivePath = `${String.fromCharCode(i)}:\\`;
    try { if (fs.existsSync(drivePath)) drives.push(drivePath); } catch (err: unknown) {
      logger.warn("Failed to check drive accessibility", { operation: "get-drives", metadata: { drivePath, error: err instanceof Error ? err.message : String(err) } });
    }
  }
  return drives;
};

const getSearchRoots = (currentBrowsedPath: string): string[] => {
  const homedir = os.homedir();
  const searchRoots: string[] = [];

  if (currentBrowsedPath && fs.existsSync(currentBrowsedPath)) {
    searchRoots.push(currentBrowsedPath);
    const parent = path.dirname(currentBrowsedPath);
    if (parent && fs.existsSync(parent) && !searchRoots.includes(parent)) searchRoots.push(parent);
  }

  for (const p of [homedir, path.join(homedir, "Desktop"), path.join(homedir, "Documents"), path.join(homedir, "Downloads"), path.join(homedir, "Projects"), path.join(homedir, "Developer"), path.join(homedir, "Workspace"), path.join(homedir, "source", "repos"), path.join(homedir, "repos")]) {
    if (!searchRoots.includes(p)) searchRoots.push(p);
  }

  if (process.platform === "win32") {
    for (const drive of getAvailableDrives()) { if (!searchRoots.includes(drive)) searchRoots.push(drive); }
  } else if (!searchRoots.includes("/")) {
    searchRoots.push("/");
  }

  return searchRoots;
};

const getFolderVariants = (folderName: string): string[] =>
  Array.from(new Set([folderName, folderName.replace(/\s+/g, "-"), folderName.replace(/-/g, " "), folderName.replace(/[_\s-]+/g, "")])).filter(Boolean);

const scoreCandidate = (cand: string, sampleFiles: readonly string[]): number => {
  let score = 0;
  for (const sf of sampleFiles) { if (fs.existsSync(path.join(cand, sf))) score += 2; }
  if (fs.existsSync(path.join(cand, ".git"))) score += 1;
  return score;
};

export async function browseFilesystemHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const rawInput = typeof request.query.path === "string" ? request.query.path : "";
    const rawPath = rawInput.replace(/^["']|["']$/g, "").trim();
    const targetPath = await statDirectory(resolveTargetPath(rawPath));
    const currentIsGit = fs.existsSync(path.join(targetPath, ".git"));
    const parsed = path.parse(targetPath);
    const parentPath = targetPath === parsed.root ? null : path.dirname(targetPath);
    const directories: DirectoryItem[] = [];
    const files: FileItem[] = [];

    try {
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name))) continue;
        if (SKIP_FILES.has(entry.name)) continue;
        if (entry.isDirectory()) {
          const isGit = fs.existsSync(path.join(path.join(targetPath, entry.name), ".git"));
          directories.push({ name: entry.name, path: path.join(targetPath, entry.name), isGitRepo: isGit });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_EXTS.includes(ext)) continue;
          let sizeBytes = 0;
          try { sizeBytes = (await fs.promises.stat(path.join(targetPath, entry.name))).size; } catch { sizeBytes = 0; }
          files.push({ name: entry.name, path: path.join(targetPath, entry.name), ext: ext || "(no ext)", sizeBytes });
        }
      }
    } catch (readErr) { throw new AppError(`Unable to read directory: ${readErr instanceof Error ? readErr.message : "Access denied"}`, "VALIDATION_ERROR", 400); }

    directories.sort((a, b) => a.isGitRepo && !b.isGitRepo ? -1 : !a.isGitRepo && b.isGitRepo ? 1 : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    const shortcuts: { name: string; path: string }[] = [];
    const cwd = process.cwd();
    const workspaceParent = path.dirname(cwd);
    if (fs.existsSync(cwd)) shortcuts.push({ name: `Current Project (${path.basename(cwd)})`, path: cwd });
    if (fs.existsSync(workspaceParent)) shortcuts.push({ name: `Workspace (${path.basename(workspaceParent)})`, path: workspaceParent });

    response.status(200).json({ currentPath: targetPath, parentPath, isGitRepo: currentIsGit, directories, files, shortcuts });
  } catch (error) {
    next(error);
  }
}

export async function resolveFolderHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getRequestBody(request) as Partial<ResolveFolderRequest>;
    const folderName = typeof body.folderName === "string" ? body.folderName.replace(/^["']|["']$/g, "").trim() : "";
    const sampleFiles = Array.isArray(body.sampleFiles) ? body.sampleFiles.filter((f): f is string => typeof f === "string") : [];
    const currentBrowsedPath = typeof body.currentBrowsedPath === "string" ? body.currentBrowsedPath.trim() : "";

    if (!folderName) throw new AppError("Folder name is required for resolution", "VALIDATION_ERROR", 400);

    const variants = getFolderVariants(folderName);
    const searchRoots = getSearchRoots(currentBrowsedPath);
    const matchedPaths: string[] = [];

    for (const root of searchRoots) {
      if (!fs.existsSync(root)) continue;
      for (const variant of variants) {
        const candidate = path.join(root, variant);
        if (fs.existsSync(candidate)) {
          try { if (fs.statSync(candidate).isDirectory()) matchedPaths.push(candidate); } catch (err: unknown) {
            logger.warn("Failed to stat candidate directory", { operation: "resolve-folder", metadata: { candidate, error: err instanceof Error ? err.message : String(err) } });
          }
        }
      }
      try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "$RECYCLE.BIN") continue;
          const entryLower = entry.name.toLowerCase();
          if (variants.some((v) => entryLower === v.toLowerCase() || entryLower.replace(/[_\s-]+/g, "") === v.toLowerCase().replace(/[_\s-]+/g, ""))) {
            matchedPaths.push(path.join(root, entry.name));
          }
        }
      } catch (err: unknown) {
        logger.warn("Failed to read directory entries", { operation: "resolve-folder", metadata: { root, error: err instanceof Error ? err.message : String(err) } });
      }
    }

    const scoredCandidates = Array.from(new Set(matchedPaths))
      .map((cand) => ({ path: cand, score: scoreCandidate(cand, sampleFiles) }))
      .sort((a, b) => b.score - a.score);

    const best = scoredCandidates[0]?.path ?? null;
    response.status(200).json({
      resolvedPath: best,
      folderName: best ? path.basename(best) : folderName,
      exists: Boolean(best && fs.existsSync(best)),
      isGitRepo: Boolean(best && fs.existsSync(path.join(best, ".git"))),
      candidates: scoredCandidates.map((c) => c.path),
    });
  } catch (error) {
    next(error);
  }
}

export async function pickNativeDialogHandler(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const selectedPath = await showNativeFolderDialog();
    if (!selectedPath) {
      response.status(200).json({ cancelled: true });
      return;
    }
    const exists = fs.existsSync(selectedPath);
    response.status(200).json({
      path: selectedPath,
      folderName: path.basename(selectedPath) || selectedPath,
      isGitRepo: exists && fs.existsSync(path.join(selectedPath, ".git")),
      cancelled: false,
    });
  } catch (error) {
    next(error);
  }
}

function showNativeFolderDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const psScript = `Add-Type -AssemblyName System.Windows.Forms\n$dialog = New-Object System.Windows.Forms.FolderBrowserDialog\n$dialog.Description = "Select any repository or project folder"\n$dialog.ShowNewFolderButton = $true\n$topForm = New-Object System.Windows.Forms.Form\n$topForm.TopMost = $true\n$res = $dialog.ShowDialog($topForm)\nif ($res -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }\n$topForm.Dispose()`;
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      execFile("powershell.exe", ["-NoProfile", "-STA", "-EncodedCommand", encoded], { timeout: 120000 }, (err, stdout) => {
        if (err || !stdout) resolve(null);
        else { const picked = stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim(); resolve(picked && fs.existsSync(picked) ? picked : null); }
      });
    } else if (process.platform === "darwin") {
      execFile("osascript", ["-e", 'POSIX path of (choose folder with prompt "Select a repository folder:")'], { timeout: 120000 }, (err, stdout) => { if (err || !stdout) resolve(null); else resolve(stdout.trim()); });
    } else {
      execFile("zenity", ["--file-selection", "--directory", "--title=Select Repository Folder"], { timeout: 120000 }, (err, stdout) => { if (!err && stdout) resolve(stdout.trim()); else resolve(null); });
    }
  });
}

export async function openInOsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getRequestBody(request);
    const filePath = typeof body.filePath === "string" ? body.filePath.trim() : "";
    const repoId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : "";
    const mode = typeof body.mode === "string" ? body.mode : "reveal";

    if (!filePath && !repoId) throw new AppError("filePath or repositoryId is required", "VALIDATION_ERROR", 400);

    let fullPath = filePath;
    if (repoId) {
      const repoPath = getExecutionPath(repoId);
      fullPath = filePath ? (path.isAbsolute(filePath) ? filePath : path.resolve(repoPath, filePath)) : repoPath;
    } else if (filePath && !path.isAbsolute(filePath)) {
      fullPath = path.resolve(process.cwd(), filePath);
    }

    if (!fs.existsSync(fullPath)) throw new AppError(`Path does not exist: ${fullPath}`, "VALIDATION_ERROR", 404);

    const isDir = (await fs.promises.stat(fullPath)).isDirectory();
    openPathInOs(fullPath, isDir, mode);

    response.status(200).json({ success: true, path: fullPath, mode });
  } catch (error) {
    next(error);
  }
}

const openPathInOs = (fullPath: string, isDir: boolean, mode: string): void => {
  if (process.platform === "win32") {
    if (mode === "reveal") {
      execFile("explorer.exe", [isDir ? fullPath : `/select,${fullPath}`], () => { });
    } else {
      execFile("code", [fullPath], (err) => { if (err) execFile("cmd.exe", ["/c", "start", "", fullPath], () => { }); });
    }
  } else if (process.platform === "darwin") {
    execFile("open", [mode === "reveal" ? "-R" : "", fullPath].filter(Boolean), () => { });
  } else {
    execFile("xdg-open", [isDir ? fullPath : path.dirname(fullPath)], () => { });
  }
};
