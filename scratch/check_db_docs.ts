import { query } from "../src/db/postgres.js";

async function main() {
  try {
    const docs = await query("SELECT id, tenant_id, filename, status, created_at FROM documents;");
    console.log("=== DOCUMENTS ===");
    console.dir(docs.rows);

    const chunks = await query("SELECT id, document_id, tenant_id, filename, length(content) as len, substring(content from 1 for 100) as sample FROM document_chunks LIMIT 10;");
    console.log("=== DOCUMENT CHUNKS ===");
    console.dir(chunks.rows);
  } catch (err) {
    console.error("DB Query Error:", err);
  }
}

main();
