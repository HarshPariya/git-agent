import { embedText } from "./embedder.js";
import { query, withTransaction } from "../db/postgres.js";
import type { DocumentChunk } from "./document-chunker.js";
import type { DocumentSourceMetadata } from "./document-parser.js";

export interface InMemDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly createdAt: Date;
  readonly chunks: readonly DocumentChunk[];
}

export const inMemoryDocumentStore: InMemDocument[] = [];

export async function indexDocument(
  metadata: DocumentSourceMetadata,
  sizeBytes: number,
  chunks: readonly DocumentChunk[],
): Promise<{ insertedChunks: number; storage: "postgres" | "memory" }> {
  // Always update in-memory document store first for 100% resilience
  const existingIdx = inMemoryDocumentStore.findIndex((d) => d.id === metadata.documentId);
  const docRecord: InMemDocument = {
    id: metadata.documentId,
    tenantId: metadata.tenantId,
    userId: metadata.userId,
    filename: metadata.filename,
    mimeType: metadata.mimeType,
    sizeBytes,
    status: "indexed",
    createdAt: new Date(),
    chunks,
  };

  if (existingIdx >= 0) {
    inMemoryDocumentStore[existingIdx] = docRecord;
  } else {
    inMemoryDocumentStore.push(docRecord);
  }

  let insertedCount = chunks.length;

  let storage: "postgres" | "memory" = "memory";
  try {
    await withTransaction(async (client) => {
      // 1. Insert/Update Document Record
      await client.query(
        `INSERT INTO documents (id, tenant_id, user_id, filename, mime_type, size_bytes, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'indexed', NOW())
         ON CONFLICT (id) DO UPDATE SET
           filename = EXCLUDED.filename,
           size_bytes = EXCLUDED.size_bytes,
           status = 'indexed',
           updated_at = NOW();`,
        [
          metadata.documentId,
          metadata.tenantId,
          metadata.userId,
          metadata.filename,
          metadata.mimeType,
          sizeBytes,
        ],
      );

      // 2. Clear old chunks if re-indexing
      await client.query(
        `DELETE FROM document_chunks WHERE document_id = $1 AND tenant_id = $2;`,
        [metadata.documentId, metadata.tenantId],
      );

      // 3. Generate embeddings & Insert chunks
      for (const chunk of chunks) {
        const embedding = await embedText(chunk.content);
        const vectorStr = `[${embedding.join(",")}]`;

        await client.query(
          `INSERT INTO document_chunks (
             id, document_id, tenant_id, filename, page_number, section, chunk_index, content, content_hash, embedding
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector);`,
          [
            chunk.id,
            chunk.documentId,
            chunk.tenantId,
            chunk.filename,
            chunk.pageNumber ?? null,
            chunk.section ?? null,
            chunk.chunkIndex,
            chunk.content,
            chunk.contentHash,
            vectorStr,
          ],
        );
      }
    });

    console.log(
      `✓ Indexed document ${metadata.filename} (${insertedCount} chunks) for tenant ${metadata.tenantId}`,
    );
    storage = "postgres";
  } catch (err: any) {
    console.warn("⚠️ Postgres document indexing skipped/fallback:", err?.message || err);
  }

  return { insertedChunks: insertedCount, storage };
}

export async function deleteDocument(
  documentId: string,
  tenantId: string,
): Promise<boolean> {
  const memIdx = inMemoryDocumentStore.findIndex((d) => d.id === documentId && d.tenantId === tenantId);
  let memSuccess = false;
  if (memIdx >= 0) {
    inMemoryDocumentStore.splice(memIdx, 1);
    memSuccess = true;
  }

  try {
    const res = await query(
      `DELETE FROM documents WHERE id = $1 AND tenant_id = $2;`,
      [documentId, tenantId],
    );
    return memSuccess || (res.rowCount ?? 0) > 0;
  } catch (err) {
    return memSuccess;
  }
}
