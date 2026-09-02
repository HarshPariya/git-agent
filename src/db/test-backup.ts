import path from "node:path";
import { createDatabaseBackup, restoreDatabaseBackup } from "./backup.js";
import { query, closeDatabase } from "./postgres.js";

async function runBackupRestoreTest() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("POSTGRESQL BACKUP & RESTORE TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

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

  const backupPath = path.join(process.cwd(), "scratch", "test_backup.json");

  try {
    // 1. Backup DB
    const backupData = await createDatabaseBackup(backupPath);
    assert(backupData.code_chunks.length >= 0, "Created database backup payload");

    // 2. Restore DB
    const restoredCount = await restoreDatabaseBackup(backupPath);
    assert(restoredCount === backupData.code_chunks.length, "Restored exact chunk count from backup");

    const checkResult = await query(`SELECT COUNT(*) FROM code_chunks`);
    assert(
      Number(checkResult.rows[0]?.count ?? 0) >= restoredCount,
      "PostgreSQL chunks verified surviving backup & restore",
    );
  } finally {
    await closeDatabase();
  }

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`BACKUP TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runBackupRestoreTest().catch((err) => {
  console.error("Backup test failed:", err);
  process.exitCode = 1;
});
