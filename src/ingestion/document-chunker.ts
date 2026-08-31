import crypto from "node:crypto";
import type { ParsedDocumentResult } from "./document-parser.js";

export interface DocumentChunk {
  readonly id: string;
  readonly documentId: string;
  readonly tenantId: string;
  readonly filename: string;
  readonly pageNumber?: number | undefined;
  readonly section?: string | undefined;
  readonly chunkIndex: number;
  readonly content: string;
  readonly contentHash: string;
}

const TARGET_CHUNK_SIZE = 600; // characters (~120 tokens)
const CHUNK_OVERLAP = 100;

function computeHash(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex");
}

export function chunkDocument(
  parsed: ParsedDocumentResult,
): readonly DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const section of parsed.sections) {
    const text = section.content.trim();
    if (!text) continue;

    if (text.length <= TARGET_CHUNK_SIZE) {
      chunks.push({
        id: `${parsed.metadata.documentId}-chunk-${globalChunkIndex}`,
        documentId: parsed.metadata.documentId,
        tenantId: parsed.metadata.tenantId,
        filename: parsed.metadata.filename,
        pageNumber: section.pageNumber,
        section: section.section,
        chunkIndex: globalChunkIndex,
        content: text,
        contentHash: computeHash(text),
      });
      globalChunkIndex++;
      continue;
    }

    let start = 0;
    while (start < text.length) {
      let end = start + TARGET_CHUNK_SIZE;
      if (end < text.length) {
        const lastLineBreak = text.lastIndexOf("\n", end);
        const lastSpace = text.lastIndexOf(" ", end);
        const preferredBoundary = lastLineBreak > start + CHUNK_OVERLAP ? lastLineBreak : lastSpace;
        if (preferredBoundary > start + CHUNK_OVERLAP) {
          end = preferredBoundary;
        }
      }

      const chunkText = text.slice(start, end).trim();
      if (chunkText.length > 0) {
        chunks.push({
          id: `${parsed.metadata.documentId}-chunk-${globalChunkIndex}`,
          documentId: parsed.metadata.documentId,
          tenantId: parsed.metadata.tenantId,
          filename: parsed.metadata.filename,
          pageNumber: section.pageNumber,
          section: section.section,
          chunkIndex: globalChunkIndex,
          content: chunkText,
          contentHash: computeHash(chunkText),
        });
        globalChunkIndex++;
      }

      const rawNextStart = end - CHUNK_OVERLAP;
      const nextLineBreak = text.indexOf("\n", rawNextStart);
      start = nextLineBreak >= rawNextStart && nextLineBreak < end
        ? nextLineBreak + 1
        : rawNextStart;
      if (start >= text.length - CHUNK_OVERLAP) break;
    }
  }

  return chunks;
}
