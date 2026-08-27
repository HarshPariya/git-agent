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
]);

export const IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function isPathWithinRoot(
  filePath: string,
  rootDirectory: string,
): boolean {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedFile = path.resolve(filePath);

  return (
    resolvedFile.startsWith(resolvedRoot) &&
    resolvedFile !== resolvedRoot
  );
}

export function isSecretFile(filename: string): boolean {
  const basename = path.basename(filename);
  return SECRET_PATTERNS.some((pattern) => pattern.test(basename));
}

export function isIgnoredDirectory(dirName: string): boolean {
  return IGNORED_DIRECTORIES.has(dirName);
}

export function isIgnoredFile(filename: string): boolean {
  const basename = path.basename(filename);
  if (IGNORED_FILES.has(basename)) {
    return true;
  }
  return isSecretFile(basename);
}
