import path from "node:path";
import type { ParsedClass, ParsedFile, ParsedFunction, SupportedLanguage } from "./parser.js";

export type ChunkType = "file" | "function" | "class";

export interface CodeChunk {
  id: string;
  type: ChunkType;
  filePath: string;
  language: SupportedLanguage;
  name?: string | undefined;
  startLine: number;
  endLine: number;
  content: string;
  metadata: { fileName: string; directory: string; imports: string[] };
}

const createChunkId = (filePath: string, type: ChunkType, name: string, startLine: number): string =>
  `${filePath.replace(/\\/g, "/").replace(/[^a-zA-Z0-9/_-]/g, "-")}:${type}:${name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}:${startLine}`;

const getLineCount = (content: string): number => content.split(/\r?\n/).length || 0;

const createMetadata = (file: ParsedFile) => ({
  fileName: path.basename(file.filePath),
  directory: path.dirname(file.filePath),
  imports: file.imports.map((item) => item.source),
});

const buildChunk = (
  file: ParsedFile,
  type: ChunkType,
  name: string,
  startLine: number,
  endLine: number,
  content: string,
): CodeChunk => ({
  id: createChunkId(file.filePath, type, name, startLine),
  type,
  filePath: file.filePath,
  language: file.language,
  name,
  startLine,
  endLine,
  content,
  metadata: createMetadata(file),
});

const functionToChunk = (file: ParsedFile, fn: ParsedFunction): CodeChunk =>
  buildChunk(file, "function", fn.name, fn.startLine, fn.endLine, fn.content);

const classToChunk = (file: ParsedFile, cls: ParsedClass): CodeChunk =>
  buildChunk(file, "class", cls.name, cls.startLine, cls.endLine, cls.content);

const fileToChunk = (file: ParsedFile): CodeChunk =>
  buildChunk(file, "file", path.basename(file.filePath), 1, Math.max(getLineCount(file.content), 1), file.content);

export const chunkFile = (file: ParsedFile): CodeChunk[] => {
  const chunks = [
    ...file.functions.map((fn) => functionToChunk(file, fn)),
    ...file.classes.map((cls) => classToChunk(file, cls)),
  ];

  return chunks.length > 0 ? chunks : file.content.trim().length > 0 ? [fileToChunk(file)] : [];
};

export const chunkRepository = (parsedFiles: ParsedFile[]): CodeChunk[] =>
  parsedFiles.flatMap((file) => chunkFile(file));
