import crypto from "node:crypto";
import path from "node:path";

export function validateToken(providedToken: string | undefined, expectedToken: string): boolean {
  if (!providedToken || !expectedToken) return false;
  const cleanProvided = providedToken.replace(/^Bearer\s+/i, "").trim();
  const cleanExpected = expectedToken.trim();

  if (cleanProvided.length !== cleanExpected.length) return false;

  const bufProvided = Buffer.from(cleanProvided, "utf-8");
  const bufExpected = Buffer.from(cleanExpected, "utf-8");

  try {
    return crypto.timingSafeEqual(bufProvided, bufExpected);
  } catch {
    return false;
  }
}

export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // Direct non-browser curl/companion requests
  if (allowedOrigins.includes(origin)) return true;

  try {
    const url = new URL(origin);
    // Allow loopback and localhost origins on any port
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
    // Allow Vercel deployment domains
    if (url.hostname.endsWith(".vercel.app")) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export function assertWithinRoot(targetPath: string, rootPath: string): string {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Access denied: path '${targetPath}' escapes root '${rootPath}'`);
  }

  return resolvedTarget;
}

export function validateSafeRepoPath(candidatePath: string): string {
  if (!candidatePath || typeof candidatePath !== "string") {
    throw new Error("Repository path is required");
  }

  const normalized = path.resolve(candidatePath.trim());
  if (normalized.includes("\0")) {
    throw new Error("Invalid characters in repository path");
  }

  return normalized;
}
