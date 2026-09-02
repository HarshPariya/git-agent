import path from "node:path";

/** Stable repository identity used by chunks, graph nodes, cache and vectors. */
export function toRepositoryPath(rootDirectory: string, filePath: string): string {
  return path.relative(path.resolve(rootDirectory), path.resolve(filePath)).replace(/\\/g, "/");
}

