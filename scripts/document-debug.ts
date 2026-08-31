import { query } from "../src/db/postgres.js";
import { inMemoryDocumentStore } from "../src/ingestion/document-indexer.js";
import { DocumentRetriever } from "../src/retrieval/document-retriever.js";

export async function runDocumentDiagnostic(documentId: string): Promise<void> {
  console.log(`\n==================================================`);
  console.log(`[DOCUMENT DEBUG] Running diagnostic for documentId: ${documentId}`);
  console.log(`==================================================`);

  let docRecord: any = null;
  let totalChunks = 0;
  let chunksWithEmbedding = 0;
  let chunks: Array<{ id: string; pageNumber: number | null; chunkIndex: number; content: string }> = [];
  let tenantId = "default-tenant";

  try {
    const docRes = await query(
      "SELECT id, tenant_id, filename, status FROM documents WHERE id = $1",
      [documentId],
    );
    if (docRes.rows.length > 0) {
      docRecord = docRes.rows[0];
      tenantId = docRecord.tenant_id;
    }

    const chunkRes = await query(
      "SELECT id, page_number, chunk_index, content, (embedding IS NOT NULL) as has_embed FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index",
      [documentId],
    );
    totalChunks = chunkRes.rows.length;
    chunksWithEmbedding = chunkRes.rows.filter((r) => r.has_embed).length;
    chunks = chunkRes.rows.map((row) => ({
      id: row.id,
      pageNumber: row.page_number,
      chunkIndex: row.chunk_index,
      content: row.content,
    }));
  } catch (err: any) {
    console.warn("⚠️ DB check query skipped/failed:", err?.message || err);
  }

  // Fallback to in-memory store
  const memDoc = inMemoryDocumentStore.find((d) => d.id === documentId);
  if (memDoc) {
    tenantId = memDoc.tenantId;
    if (!docRecord) {
      docRecord = {
        id: memDoc.id,
        filename: memDoc.filename,
        tenant_id: memDoc.tenantId,
        status: memDoc.status,
      };
    }
    if (totalChunks === 0) {
      totalChunks = memDoc.chunks.length;
      chunksWithEmbedding = memDoc.chunks.length;
      chunks = memDoc.chunks.map((chunk) => ({
        id: chunk.id,
        pageNumber: chunk.pageNumber ?? null,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      }));
    }
  }

  console.log("Document Record:", docRecord || "NOT FOUND");
  console.log(`totalChunks: ${totalChunks}`);
  console.log(`chunksWithEmbedding: ${chunksWithEmbedding}`);
  console.log("\nComplete extracted chunks:");
  chunks.forEach((chunk) => {
    console.log(`\n[${docRecord?.filename ?? "document"}]`);
    console.log(`documentId=${documentId} pageNumber=${chunk.pageNumber} chunkIndex=${chunk.chunkIndex}`);
    console.log(`CHUNK ${chunk.chunkIndex + 1}:\n${chunk.content}`);
  });
  const completeText = chunks.map((chunk) => chunk.content).join("\n");
  console.log(`\nOCR contains "28": ${/(^|\D)28(\D|$)/.test(completeText)}`);
  console.log(`OCR contains "Rishabh": ${/rishabh/i.test(completeText)}`);

  if (totalChunks === 0) {
    console.error("❌ ERROR: totalChunks = 0. Document storage/indexing failed.");
    return;
  }

  // Test Retrieval
  const retriever = new DocumentRetriever();
  const testResults = await retriever.search({
    query: "what is in document",
    tenantId,
    documentIds: [documentId],
    limit: 5,
  });

  console.log(`\nRetrieval test for 'what is in document': ${testResults.length} candidates returned.`);
  testResults.forEach((r, i) => {
    console.log(`#${i + 1} score=${r.score.toFixed(3)} file=${r.filename} page=${r.pageNumber} snippet="${r.content.slice(0, 100)}..."`);
  });

  console.log(`==================================================\n`);
}

const docIdArg = process.argv[2];
if (docIdArg) {
  runDocumentDiagnostic(docIdArg).then(() => process.exit(0));
}
