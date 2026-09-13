import { closeDatabase, testDatabaseConnection } from "./mongodb.js";
import { initializeSchema } from "./schema.js";

const SEPARATOR = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";

const main = async () => {
  console.warn(SEPARATOR);
  console.warn("MONGODB ATLAS TEST");
  console.warn(`${SEPARATOR}\n`);

  if (!(await testDatabaseConnection())) {
    process.exitCode = 1;
    return;
  }

  initializeSchema();
  console.warn("\nMongoDB Atlas setup successful.");
};

main()
  .catch((error) => {
    console.error("Database setup failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDatabase);
