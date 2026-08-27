import path from "node:path";
import type {
  ParsedClass,
  ParsedFile,
  ParsedFunction,
  SupportedLanguage,
} from "./parser.js";

export type ChunkType =
  | "file"
  | "function"
  | "class";

export interface CodeChunk {
  id: string;
  type: ChunkType;

  filePath: string;
  language: SupportedLanguage;

  name?: string;

  startLine: number;
  endLine: number;

  content: string;

  metadata: {
    fileName: string;
    directory: string;
    imports: string[];
  };
}

function createChunkId(
  filePath: string,
  type: ChunkType,
  name: string,
  startLine: number,
): string {
  const normalizedPath = filePath
    .replace(/\\/g, "/")
    .replace(/[^a-zA-Z0-9/_-]/g, "-");

  const normalizedName = name
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();

  return `${normalizedPath}:${type}:${normalizedName}:${startLine}`;
}

function getLineCount(content: string): number {
  if (!content) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

function createMetadata(file: ParsedFile) {
  return {
    fileName: path.basename(file.filePath),
    directory: path.dirname(file.filePath),
    imports: file.imports.map((item) => item.source),
  };
}

function functionToChunk(
  file: ParsedFile,
  fn: ParsedFunction,
): CodeChunk {
  return {
    id: createChunkId(
      file.filePath,
      "function",
      fn.name,
      fn.startLine,
    ),

    type: "function",

    filePath: file.filePath,
    language: file.language,

    name: fn.name,

    startLine: fn.startLine,
    endLine: fn.endLine,

    content: fn.content,

    metadata: createMetadata(file),
  };
}

function classToChunk(
  file: ParsedFile,
  classInfo: ParsedClass,
): CodeChunk {
  return {
    id: createChunkId(
      file.filePath,
      "class",
      classInfo.name,
      classInfo.startLine,
    ),

    type: "class",

    filePath: file.filePath,
    language: file.language,

    name: classInfo.name,

    startLine: classInfo.startLine,
    endLine: classInfo.endLine,

    content: classInfo.content,

    metadata: createMetadata(file),
  };
}

function fileToChunk(file: ParsedFile): CodeChunk {
  const lineCount = getLineCount(file.content);

  return {
    id: createChunkId(
      file.filePath,
      "file",
      path.basename(file.filePath),
      1,
    ),

    type: "file",

    filePath: file.filePath,
    language: file.language,

    name: path.basename(file.filePath),

    startLine: 1,
    endLine: Math.max(lineCount, 1),

    content: file.content,

    metadata: createMetadata(file),
  };
}

export function chunkFile(file: ParsedFile): CodeChunk[] {
  const chunks: CodeChunk[] = [];

  /*
   * Prefer semantic chunks such as functions and classes.
   * If no code structures were discovered, fall back to
   * creating a file-level chunk.
   */

  for (const fn of file.functions) {
    chunks.push(functionToChunk(file, fn));
  }

  for (const classInfo of file.classes) {
    chunks.push(classToChunk(file, classInfo));
  }

  if (chunks.length === 0 && file.content.trim().length > 0) {
    chunks.push(fileToChunk(file));
  }

  return chunks;
}

export function chunkRepository(
  parsedFiles: ParsedFile[],
): CodeChunk[] {
  const chunks: CodeChunk[] = [];

  for (const file of parsedFiles) {
    chunks.push(...chunkFile(file));
  }

  return chunks;
}
