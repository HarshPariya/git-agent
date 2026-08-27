import fs from "node:fs/promises";
import path from "node:path";
import { RepositoryIndexer } from "./indexer.js";
import { query, closeDatabase } from "../db/postgres.js";

async function safeUnlink(filePath: string, retries = 5, delay = 100): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.unlink(filePath);
      return;
    } catch (err: any) {
      if (err?.code === "ENOENT") return;
      if (i === retries - 1) throw err;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

async function runIndexerLifecycleTest() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("AUTOMATIC INDEXING LIFECYCLE TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  const repoDir = process.cwd();
  const indexer = new RepositoryIndexer(repoDir, "test-auto-repo");

  const tempFile = path.join(repoDir, "scratch", "auto_index_demo.ts");
  await fs.mkdir(path.dirname(tempFile), { recursive: true });

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  try {
    // 1. Create file & index incrementally
    console.log("1. Creating temporary file & auto-indexing...");
    await fs.writeFile(
      tempFile,
      "export function calculateDiscount(price: number) { return price * 0.9; }",
    );

    const indexStats = await indexer.indexSingleFile(tempFile);
    assert(indexStats.action === "indexed", "Single file indexed successfully");
    assert(indexStats.chunksCount > 0, "Created chunks for newly added file");

    // Check DB
    const dbCheck1 = await query(
      `SELECT COUNT(*) FROM code_chunks WHERE repository = $1 AND file_path = $2`,
      ["test-auto-repo", path.normalize(tempFile)],
    );
    assert(
      Number(dbCheck1.rows[0].count) > 0,
      "DB contains indexed chunks for temp file",
    );

    // 2. Delete file & test auto cleanup
    console.log();
    console.log("2. Deleting temporary file & testing auto-cleanup...");
    await safeUnlink(tempFile);

    const deleteStats = await indexer.indexSingleFile(tempFile);
    assert(deleteStats.action === "deleted", "Detected file removal automatically");

    const dbCheck2 = await query(
      `SELECT COUNT(*) FROM code_chunks WHERE repository = $1 AND file_path = $2`,
      ["test-auto-repo", path.normalize(tempFile)],
    );
    assert(
      Number(dbCheck2.rows[0].count) === 0,
      "DB automatically pruned all chunks for deleted file",
    );

  } finally {
    // Clean up test chunks from DB
    await query(`DELETE FROM code_chunks WHERE repository = $1`, ["test-auto-repo"]);
    await closeDatabase();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`INDEXER LIFECYCLE TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runIndexerLifecycleTest().catch((err) => {
  console.error("Indexer test failed:", err);
  process.exitCode = 1;
});
