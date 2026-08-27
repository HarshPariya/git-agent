import {
  closeDatabase,
  testDatabaseConnection,
} from "./postgres.js";

import {
  initializeSchema,
} from "./schema.js";

async function main() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log(
    "POSTGRESQL + PGVECTOR TEST",
  );

  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  );

  console.log();

  const connected =
    await testDatabaseConnection();

  if (!connected) {
    process.exitCode = 1;
    return;
  }

  await initializeSchema();

  console.log();
  console.log(
    "✓ PostgreSQL + pgvector setup successful.",
  );
}

main()
  .catch((error) => {
    console.error(
      "Database setup failed:",
    );

    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
