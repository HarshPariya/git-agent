import { closeDatabase, testDatabaseConnection } from "./postgres.js";
import { initializeSchema } from "./schema.js";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const main = async () => {
  console.log(SEPARATOR);
  console.log("POSTGRESQL + PGVECTOR TEST");
  console.log(`${SEPARATOR}\n`);

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();
  console.log("\nPostgreSQL + pgvector setup successful.");
};

main()
  .catch((error) => {
    console.error("Database setup failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
