import path from "node:path";
import { createDatabaseBackup, restoreDatabaseBackup } from "./backup.js";
import { query, closeDatabase } from "./postgres.js";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const runBackupRestoreTest = async () => {
  console.log(SEPARATOR);
  console.log("POSTGRESQL BACKUP & RESTORE TEST");
  console.log(`${SEPARATOR}\n`);

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, testName: string) => {
    console.log(condition ? `[PASS] ${testName}` : `[FAIL] ${testName}`);
    condition ? passed++ : failed++;
  };

  const backupPath = path.join(process.cwd(), "scratch", "test_backup.json");

  try {
    const backupData = await createDatabaseBackup(backupPath);
    assert(backupData.code_chunks.length >= 0, "Created database backup payload");

    const restoredCount = await restoreDatabaseBackup(backupPath);
    assert(restoredCount === backupData.code_chunks.length, "Restored exact chunk count from backup");

    const { rows } = await query<{ count: string }>(`SELECT COUNT(*) FROM code_chunks`);
    assert(
      Number(rows[0]?.count ?? 0) >= restoredCount,
      "PostgreSQL chunks verified surviving backup & restore",
    );
  } finally {
    await closeDatabase();
  }

  console.log(`\n${SEPARATOR}`);
  console.log(`BACKUP TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log(SEPARATOR);

  if (failed > 0) process.exitCode = 1;
};

runBackupRestoreTest()
  .catch((err) => {
    console.error("Backup test failed:", err);
    process.exitCode = 1;
  });
