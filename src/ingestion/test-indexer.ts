import fs from "node:fs/promises";
import path from "node:path";
import { RepositoryIndexer } from "./indexer.js";
import { query, closeDatabase } from "../db/postgres.js";

const safeUnlink = async (filePath: string, retries = 5, delay = 100): Promise<void> => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err: unknown) {
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") return;
      if (attempt === retries - 1) throw err;
      await new Promise<void>((res) => setTimeout(res, delay));
    }
  }
};

const runIndexerLifecycleTest = async () => {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAUTOMATIC INDEXING LIFECYCLE TEST\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const repoDir = process.cwd();
  const indexer = new RepositoryIndexer(repoDir, "test-auto-repo");
  const tempFile = path.join(repoDir, "scratch", "auto_index_demo.ts");

  let passed = 0;
  let failed = 0;
  const assert = (ok: boolean, name: string) => {
    console.log(ok ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    if (ok) { passed++; } else { failed++; }
  };

  try {
    await fs.mkdir(path.dirname(tempFile), { recursive: true });

    // 1. Create temp file & auto-index
    console.log("1. Creating temporary file & auto-indexing...");
    await fs.writeFile(tempFile, "export function calculateDiscount(price: number) { return price * 0.9; }");

    const indexStats = await indexer.indexSingleFile(tempFile);
    assert(indexStats.action === "indexed", "Single file indexed successfully");
    assert(indexStats.chunksCount > 0, "Created chunks for newly added file");

    const dbCheck1 = await query(
      `SELECT COUNT(*) FROM code_chunks WHERE repository = $1 AND file_path = $2`,
      ["test-auto-repo", path.normalize(tempFile)],
    );
    assert(Number(dbCheck1.rows[0]?.count ?? 0) > 0, "DB contains indexed chunks for temp file");

    // 2. Delete temp file & test auto-cleanup
    console.log("\n2. Deleting temporary file & testing auto-cleanup...");
    await safeUnlink(tempFile);
    const deleteStats = await indexer.indexSingleFile(tempFile);
    assert(deleteStats.action === "deleted", "Detected file removal automatically");

    const dbCheck2 = await query(
      `SELECT COUNT(*) FROM code_chunks WHERE repository = $1 AND file_path = $2`,
      ["test-auto-repo", path.normalize(tempFile)],
    );
    assert(Number(dbCheck2.rows[0]?.count ?? 0) === 0, "DB automatically pruned all chunks for deleted file");
  } finally {
    await query(`DELETE FROM code_chunks WHERE repository = $1`, ["test-auto-repo"]);
    await closeDatabase();

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nINDEXER LIFECYCLE TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (failed > 0) process.exitCode = 1;
  }
};

runIndexerLifecycleTest().catch((err) => {
  console.error("Indexer test failed:", err);
  process.exitCode = 1;
});
