import fs from "node:fs/promises";
import path from "node:path";

const SENSITIVE_READ_PATTERNS = [
  /\.env/i,
  /\.git/i,
  /\.key$/i,
  /\.pem$/i,
  /id_rsa/i,
];

const PROTECTED_WRITE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".env",
  ".env.local",
  ".gitignore",
  "readme.md",
  "README.md",
  "license",
  "LICENSE",
]);

const PROTECTED_DELETE_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  ".env",
  ".env.local",
  ".gitignore",
  "readme.md",
  "README.md",
  "license",
  "LICENSE",
  "dockerfile",
  "Dockerfile",
  "docker-compose.yml",
]);

const PROTECTED_DELETE_DIRS = new Set([
  "",
  ".",
  "src",
  "docs",
  "public",
  "tests",
  "migrations",
  "node_modules",
  ".git",
]);

const EXCLUDED_SCAN_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  "tmp",
  "temp",
]);

export type ToolOperationType = "read" | "write" | "delete";

export const sanitizeWorkspacePath = (
  baseDir: string,
  requestedPath: string,
  op: ToolOperationType = "read",
): string => {
  const containsNull = requestedPath.includes("\0");
  containsNull &&
    (() => {
      throw new Error("Path contains illegal null bytes");
    })();

  const filename = path.basename(requestedPath);
  const lowerFilename = filename.toLowerCase();

  if (op === "read") {
    const isSensitive = SENSITIVE_READ_PATTERNS.some((pattern) =>
      pattern.test(requestedPath),
    );
    if (isSensitive) {
      throw new Error("Access denied: reading sensitive file is prohibited");
    }
  } else if (op === "write") {
    const isProtectedWrite =
      PROTECTED_WRITE_FILES.has(filename) ||
      PROTECTED_WRITE_FILES.has(lowerFilename) ||
      lowerFilename.startsWith(".env");
    if (isProtectedWrite) {
      throw new Error(
        "Access denied: writing to protected system file is disallowed",
      );
    }
  } else if (op === "delete") {
    const isProtectedDelete =
      PROTECTED_DELETE_FILES.has(filename) ||
      PROTECTED_DELETE_FILES.has(lowerFilename) ||
      lowerFilename.startsWith(".env");
    if (isProtectedDelete) {
      throw new Error(
        "Access denied: deleting protected project file is prohibited",
      );
    }
  }

  const resolved = path.resolve(baseDir, requestedPath);
  const relative = path.relative(baseDir, resolved);
  const isEscaping = relative.startsWith("..") || path.isAbsolute(relative);
  if (isEscaping) {
    throw new Error("Access denied: path escapes workspace root");
  }

  if (op === "delete") {
    const isProtectedDir = PROTECTED_DELETE_DIRS.has(
      relative.replace(/\\/g, "/"),
    );
    if (isProtectedDir) {
      throw new Error(
        "Access denied: deleting root system directory is prohibited",
      );
    }
  }

  return resolved;
};

const findFileInWorkspace = async (
  dir: string,
  targetFilename: string,
  depth = 0,
): Promise<string | null> => {
  if (depth > 5) return null;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDED_SCAN_DIRS.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        const found = await findFileInWorkspace(
          path.join(dir, entry.name),
          targetFilename,
          depth + 1,
        );
        if (found) return found;
      } else if (entry.isFile() && entry.name === targetFilename) {
        return path.join(dir, entry.name);
      }
    }
  } catch {
    // Ignore unreadable directories
  }

  return null;
};

export const resolveWorkspaceCandidate = async (
  baseDir: string,
  requestedPath: string,
  op: ToolOperationType = "read",
): Promise<string> => {
  const directPath = sanitizeWorkspacePath(baseDir, requestedPath, op);

  try {
    await fs.access(directPath);
    return directPath;
  } catch {
    const filename = path.basename(requestedPath);
    if (
      filename &&
      !requestedPath.includes("/") &&
      !requestedPath.includes("\\")
    ) {
      const match = await findFileInWorkspace(baseDir, filename);
      if (match) {
        return match;
      }
    }
    return directPath;
  }
};
