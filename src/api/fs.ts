import type { NextFunction, Request, Response } from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "../errors/app-error.js";

export interface DirectoryItem {
  readonly name: string;
  readonly path: string;
  readonly isGitRepo: boolean;
}

export interface FileItem {
  readonly name: string;
  readonly path: string;
  readonly ext: string;
  readonly sizeBytes: number;
}

export interface BrowseResult {
  readonly currentPath: string;
  readonly parentPath: string | null;
  readonly isGitRepo: boolean;
  readonly directories: readonly DirectoryItem[];
  readonly files: readonly FileItem[];
  readonly shortcuts: readonly { name: string; path: string }[];
}

export interface ResolveFolderRequest {
  readonly folderName: string;
  readonly sampleFiles?: readonly string[];
  readonly currentBrowsedPath?: string;
}

export interface ResolveFolderResult {
  readonly resolvedPath: string | null;
  readonly folderName: string;
  readonly exists: boolean;
  readonly isGitRepo: boolean;
  readonly candidates: readonly string[];
}

export interface PickNativeDialogResult {
  readonly path?: string;
  readonly folderName?: string;
  readonly isGitRepo?: boolean;
  readonly cancelled: boolean;
}

function getAvailableDrives(): readonly string[] {
  if (process.platform !== "win32") {
    return ["/"];
  }
  const drives: string[] = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const drivePath = `${letter}:\\`;
    try {
      if (fs.existsSync(drivePath)) {
        drives.push(drivePath);
      }
    } catch {
      // Ignore inaccessible drives
    }
  }
  return drives;
}

export async function browseFilesystemHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const rawInput = typeof request.query.path === "string" ? request.query.path : "";
    const rawPath = rawInput.replace(/^["']|["']$/g, "").trim();
    const homedir = os.homedir();
    let targetPath: string;

    if (!rawPath) {
      targetPath = homedir;
    } else if (rawPath === "~" || rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
      const sub = rawPath.replace(/^~[/\\]?/, "");
      targetPath = path.resolve(homedir, sub);
    } else if (rawPath.length === 2 && /^[a-zA-Z]:$/.test(rawPath)) {
      targetPath = `${rawPath}\\`;
    } else {
      targetPath = path.resolve(rawPath);
    }

    // Check directory existence
    try {
      const stat = await fs.promises.stat(targetPath);
      if (!stat.isDirectory()) {
        targetPath = path.dirname(targetPath);
      }
    } catch {
      targetPath = homedir;
    }

    // Check if current target directory is a git repo
    const currentIsGit = fs.existsSync(path.join(targetPath, ".git"));

    // Determine parent path
    const parsed = path.parse(targetPath);
    const parentPath = targetPath === parsed.root ? null : path.dirname(targetPath);

    // Read entries — include both directories and code files
    const directories: DirectoryItem[] = [];
    const files: FileItem[] = [];

    try {
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden internal folders and build/node directories
        if (entry.isDirectory() && (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "$RECYCLE.BIN" || entry.name === "dist" || entry.name === "build" || entry.name === ".cache")) continue;

        if (entry.name === ".git" || entry.name === ".DS_Store" || entry.name === "Thumbs.db") continue;

        if (entry.isDirectory()) {
          const fullPath = path.join(targetPath, entry.name);
          let isGit = false;
          try {
            isGit = fs.existsSync(path.join(fullPath, ".git"));
          } catch {
            isGit = false;
          }
          directories.push({
            name: entry.name,
            path: fullPath,
            isGitRepo: isGit,
          });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          // Exclude large binary/executable extensions
          const isBinary = [".exe", ".dll", ".so", ".dylib", ".bin", ".iso", ".zip", ".tar", ".gz", ".7z", ".png", ".jpg", ".jpeg", ".ico", ".webp", ".pdf"].includes(ext);
          if (!isBinary) {
            const fullPath = path.join(targetPath, entry.name);
            let sizeBytes = 0;
            try {
              const stat = await fs.promises.stat(fullPath);
              sizeBytes = stat.size;
            } catch {
              sizeBytes = 0;
            }
            files.push({
              name: entry.name,
              path: fullPath,
              ext: ext || "(no ext)",
              sizeBytes,
            });
          }
        }
      }
    } catch (readErr) {
      // Permission or system read error
      throw new AppError(
        `Unable to read directory: ${readErr instanceof Error ? readErr.message : "Access denied"}`,
        "VALIDATION_ERROR",
        400,
      );
    }

    // Sort: git repos first, then alphabetical for dirs; alphabetical for files
    directories.sort((a, b) => {
      if (a.isGitRepo && !b.isGitRepo) return -1;
      if (!a.isGitRepo && b.isGitRepo) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

    // Helpful navigation shortcuts — user-centric and cross-platform (Mac, Windows, Linux)
    const shortcutCandidates: { name: string; path: string }[] = [
      { name: "🏠 Home Directory", path: homedir },
      { name: "🖥️ Desktop", path: path.join(homedir, "Desktop") },
      { name: "📄 Documents", path: path.join(homedir, "Documents") },
      { name: "📥 Downloads", path: path.join(homedir, "Downloads") },
      { name: "💼 Projects", path: path.join(homedir, "Projects") },
      { name: "💼 Developer", path: path.join(homedir, "Developer") },
      { name: "💼 Workspace", path: path.join(homedir, "Workspace") },
      { name: "💼 Repos", path: path.join(homedir, "source", "repos") },
      { name: "💼 Repos", path: path.join(homedir, "repos") },
    ];

    if (process.platform === "win32") {
      const drives = getAvailableDrives();
      for (const drive of drives) {
        shortcutCandidates.push({ name: `💾 Drive ${drive}`, path: drive });
      }
    } else {
      shortcutCandidates.push({ name: "🗄️ System Root (/)", path: "/" });
      if (process.platform === "darwin" && fs.existsSync("/Volumes")) {
        shortcutCandidates.push({ name: "💾 External Volumes", path: "/Volumes" });
      }
    }

    const shortcuts = shortcutCandidates.filter((s) => {
      try {
        return fs.existsSync(s.path);
      } catch {
        return false;
      }
    });

    const result: BrowseResult = {
      currentPath: targetPath,
      parentPath,
      isGitRepo: currentIsGit,
      directories,
      files,
      shortcuts,
    };

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function resolveFolderHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Partial<ResolveFolderRequest>;
    const folderName = typeof body.folderName === "string" ? body.folderName.replace(/^["']|["']$/g, "").trim() : "";
    const sampleFiles = Array.isArray(body.sampleFiles) ? body.sampleFiles.filter((f): f is string => typeof f === "string") : [];
    const currentBrowsedPath = typeof body.currentBrowsedPath === "string" ? body.currentBrowsedPath.trim() : "";

    if (!folderName) {
      throw new AppError("Folder name is required for resolution", "VALIDATION_ERROR", 400);
    }

    const homedir = os.homedir();
    const cleanName = folderName;
    const variants = Array.from(new Set([
      cleanName,
      cleanName.replace(/\s+/g, "-"),
      cleanName.replace(/-/g, " "),
      cleanName.replace(/[_\s-]+/g, ""),
    ])).filter(Boolean);

    const searchRoots: string[] = [];
    if (currentBrowsedPath && fs.existsSync(currentBrowsedPath)) {
      searchRoots.push(currentBrowsedPath);
      const parent = path.dirname(currentBrowsedPath);
      if (parent && fs.existsSync(parent) && !searchRoots.includes(parent)) {
        searchRoots.push(parent);
      }
    }
    searchRoots.push(homedir);
    searchRoots.push(path.join(homedir, "Desktop"));
    searchRoots.push(path.join(homedir, "Documents"));
    searchRoots.push(path.join(homedir, "Downloads"));
    searchRoots.push(path.join(homedir, "Projects"));
    searchRoots.push(path.join(homedir, "Developer"));
    searchRoots.push(path.join(homedir, "Workspace"));
    searchRoots.push(path.join(homedir, "source", "repos"));
    searchRoots.push(path.join(homedir, "repos"));

    // Add available drives on Windows or root on Unix
    if (process.platform === "win32") {
      for (const drive of getAvailableDrives()) {
        if (!searchRoots.includes(drive)) searchRoots.push(drive);
      }
    } else {
      if (!searchRoots.includes("/")) searchRoots.push("/");
    }

    const matchedPaths: string[] = [];

    for (const root of searchRoots) {
      if (!fs.existsSync(root)) continue;

      // Direct check for name variants
      for (const variant of variants) {
        const candidate = path.join(root, variant);
        if (fs.existsSync(candidate)) {
          try {
            const stat = fs.statSync(candidate);
            if (stat.isDirectory()) {
              matchedPaths.push(candidate);
            }
          } catch {
            // Ignore stat errors
          }
        }
      }

      // 1-level subdirectory search for fuzzy matching
      try {
        const entries = await fs.promises.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "$RECYCLE.BIN") continue;

          const entryLower = entry.name.toLowerCase();
          const matches = variants.some((v) => {
            const vLower = v.toLowerCase();
            return (
              entryLower === vLower ||
              entryLower.replace(/[_\s-]+/g, "") === vLower.replace(/[_\s-]+/g, "")
            );
          });

          if (matches) {
            matchedPaths.push(path.join(root, entry.name));
          }
        }
      } catch {
        // Ignore read errors
      }
    }

    const uniqueCandidates = Array.from(new Set(matchedPaths));

    // If sample files provided, score candidates by presence of sample files
    const scoredCandidates = uniqueCandidates.map((cand) => {
      let score = 0;
      for (const sf of sampleFiles) {
        if (fs.existsSync(path.join(cand, sf))) {
          score += 2;
        }
      }
      if (fs.existsSync(path.join(cand, ".git"))) {
        score += 1;
      }
      return { path: cand, score };
    });

    scoredCandidates.sort((a, b) => b.score - a.score);

    const best = scoredCandidates[0]?.path || null;
    const exists = Boolean(best && fs.existsSync(best));
    const isGitRepo = Boolean(best && fs.existsSync(path.join(best, ".git")));

    const result: ResolveFolderResult = {
      resolvedPath: best,
      folderName: best ? path.basename(best) : folderName,
      exists,
      isGitRepo,
      candidates: scoredCandidates.map((c) => c.path),
    };

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function pickNativeDialogHandler(
  _request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const selectedPath = await showNativeFolderDialog();
    if (!selectedPath) {
      const cancelledResult: PickNativeDialogResult = { cancelled: true };
      response.status(200).json(cancelledResult);
      return;
    }
    const exists = fs.existsSync(selectedPath);
    const isGitRepo = exists && fs.existsSync(path.join(selectedPath, ".git"));
    const folderName = path.basename(selectedPath) || selectedPath;

    const successResult: PickNativeDialogResult = {
      path: selectedPath,
      folderName,
      isGitRepo,
      cancelled: false,
    };
    response.status(200).json(successResult);
  } catch (error) {
    next(error);
  }
}

function showNativeFolderDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Select any repository or project folder"
$dialog.ShowNewFolderButton = $true
$res = $dialog.ShowDialog()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      execFile(
        "powershell.exe",
        ["-NoProfile", "-STA", "-EncodedCommand", encoded],
        { timeout: 120000 },
        (err, stdout) => {
          if (err || !stdout) {
            resolve(null);
          } else {
            const picked = stdout.trim().split(/\r?\n/).filter(Boolean).pop()?.trim();
            resolve(picked && fs.existsSync(picked) ? picked : null);
          }
        },
      );
    } else if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", 'POSIX path of (choose folder with prompt "Select a repository folder:")'],
        { timeout: 120000 },
        (err, stdout) => {
          if (err || !stdout) resolve(null);
          else resolve(stdout.trim());
        },
      );
    } else {
      execFile(
        "zenity",
        ["--file-selection", "--directory", "--title=Select Repository Folder"],
        { timeout: 120000 },
        (err, stdout) => {
          if (!err && stdout) resolve(stdout.trim());
          else resolve(null);
        },
      );
    }
  });
}
