import { closeDatabase, testDatabaseConnection } from "./postgres.js";
import { initializeSchema } from "./schema.js";

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("POSTGRESQL + PGVECTOR TEST");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();
  console.log("\n✓ PostgreSQL + pgvector setup successful.");
}

main()
  .catch((error) => {
    console.error("Database setup failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
