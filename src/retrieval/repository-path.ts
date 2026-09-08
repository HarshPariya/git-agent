import path from "node:path";
export const toRepositoryPath = (rootDirectory: string, filePath: string): string =>
  path.relative(path.resolve(rootDirectory), path.resolve(filePath)).replace(/\\/g, "/");
