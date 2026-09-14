import path from "node:path";

export const MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

export const SECRET_PATTERNS = [
  /^\.env(\..+)?$/i,
  /\.(pem|key|crt|p12|pfx)$/i,
  /^(id_rsa|id_ed25519|credentials\.json|secrets\.json|service-account.*\.json)$/i,
];

export const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".cache",
  ".claude",
]);
export const IGNORED_FILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);

export const isPathWithinRoot = (filePath: string, rootDirectory: string): boolean => {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedFile = path.resolve(filePath);
  return resolvedFile.startsWith(resolvedRoot) && resolvedFile !== resolvedRoot;
};

export const isSecretFile = (filename: string): boolean =>
  SECRET_PATTERNS.some((pattern) => pattern.test(path.basename(filename)));

export const isIgnoredDirectory = (dirName: string): boolean => IGNORED_DIRECTORIES.has(dirName);

export const isIgnoredFile = (filename: string): boolean =>
  IGNORED_FILES.has(path.basename(filename)) || isSecretFile(filename);
