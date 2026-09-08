import path from "node:path";
import type { ParsedClass, ParsedFile, ParsedFunction, SupportedLanguage } from "./parser.js";

export type ChunkType = "file" | "function" | "class";

export interface CodeChunk {
  id: string; type: ChunkType; filePath: string; language: SupportedLanguage;
  name?: string | undefined; startLine: number; endLine: number; content: string;
  metadata: { fileName: string; directory: string; imports: string[] };
}

const createChunkId = (filePath: string, type: ChunkType, name: string, startLine: number): string =>
  `${filePath.replace(/\\/g, "/").replace(/[^a-zA-Z0-9/_-]/g, "-")}:${type}:${name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase()}:${startLine}`;

const getLineCount = (content: string): number => content ? content.split(/\r?\n/).length : 0;

const createMetadata = (file: ParsedFile) => ({ fileName: path.basename(file.filePath), directory: path.dirname(file.filePath), imports: file.imports.map((item) => item.source) });

const functionToChunk = (file: ParsedFile, fn: ParsedFunction): CodeChunk => ({
  id: createChunkId(file.filePath, "function", fn.name, fn.startLine), type: "function",
  filePath: file.filePath, language: file.language, name: fn.name,
  startLine: fn.startLine, endLine: fn.endLine, content: fn.content, metadata: createMetadata(file),
});

const classToChunk = (file: ParsedFile, classInfo: ParsedClass): CodeChunk => ({
  id: createChunkId(file.filePath, "class", classInfo.name, classInfo.startLine), type: "class",
  filePath: file.filePath, language: file.language, name: classInfo.name,
  startLine: classInfo.startLine, endLine: classInfo.endLine, content: classInfo.content, metadata: createMetadata(file),
});

const fileToChunk = (file: ParsedFile): CodeChunk => ({
  id: createChunkId(file.filePath, "file", path.basename(file.filePath), 1), type: "file",
  filePath: file.filePath, language: file.language, name: path.basename(file.filePath),
  startLine: 1, endLine: Math.max(getLineCount(file.content), 1), content: file.content, metadata: createMetadata(file),
});

export function chunkFile(file: ParsedFile): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  for (const fn of file.functions) chunks.push(functionToChunk(file, fn));
  for (const classInfo of file.classes) chunks.push(classToChunk(file, classInfo));
  if (chunks.length === 0 && file.content.trim().length > 0) chunks.push(fileToChunk(file));
  return chunks;
}

export function chunkRepository(parsedFiles: ParsedFile[]): CodeChunk[] {
  const chunks: CodeChunk[] = [];
  for (const file of parsedFiles) chunks.push(...chunkFile(file));
  return chunks;
}
