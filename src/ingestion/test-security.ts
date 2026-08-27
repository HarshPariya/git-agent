import fs from "node:fs/promises";
import path from "node:path";
import {
  isSecretFile,
  isPathWithinRoot,
  isIgnoredFile,
  MAX_FILE_SIZE_BYTES,
} from "./cleaner.js";
import { scanRepository } from "./parser.js";

async function runSecurityTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("INGESTION & RETRIEVAL SECURITY TESTS");
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

  // 1. Secret & Credentials Exclusion Tests
  assert(isSecretFile(".env") === true, "Filters .env file");
  assert(isSecretFile(".env.production") === true, "Filters .env.production file");
  assert(isSecretFile("id_rsa") === true, "Filters SSH private key id_rsa");
  assert(isSecretFile("server.pem") === true, "Filters PEM certificate server.pem");
  assert(isSecretFile("database.key") === true, "Filters database.key");
  assert(isSecretFile("credentials.json") === true, "Filters credentials.json");
  assert(isSecretFile("app.ts") === false, "Allows normal app.ts file");

  // 2. Lockfiles & Artifact Exclusion Tests
  assert(isIgnoredFile("package-lock.json") === true, "Filters package-lock.json");
  assert(isIgnoredFile("pnpm-lock.yaml") === true, "Filters pnpm-lock.yaml");

  // 3. Path Traversal Safety Tests
  const rootDir = process.cwd();
  const outsidePath = path.resolve(rootDir, "..", "outside.ts");
  const insidePath = path.resolve(rootDir, "src", "app.ts");

  assert(
    isPathWithinRoot(outsidePath, rootDir) === false,
    "Blocks out-of-root path traversal (../outside.ts)",
  );

  assert(
    isPathWithinRoot(insidePath, rootDir) === true,
    "Allows valid path within repository root (src/app.ts)",
  );

  // 4. End-to-End Temp Directory Scan Test
  const tempDir = path.join(rootDir, "scratch", "security_test_repo");
  await fs.mkdir(tempDir, { recursive: true });

  const validFile = path.join(tempDir, "valid_code.ts");
  const secretFile = path.join(tempDir, ".env.secret");
  const keyFile = path.join(tempDir, "private.key");
  const oversizedFile = path.join(tempDir, "huge_data.json");

  await fs.writeFile(validFile, "export function hello() { return 'world'; }");
  await fs.writeFile(secretFile, "API_KEY=SECRET_12345");
  await fs.writeFile(keyFile, "-----BEGIN PRIVATE KEY-----");

  // Create a 1.2 MB file
  const bigBuffer = Buffer.alloc(MAX_FILE_SIZE_BYTES + 200, "x");
  await fs.writeFile(oversizedFile, bigBuffer);

  const scannedFiles = await scanRepository(tempDir);

  const scannedBasenames = scannedFiles.map((f) => path.basename(f));

  assert(
    scannedBasenames.includes("valid_code.ts"),
    "Scanner included valid code file",
  );
  assert(
    !scannedBasenames.includes(".env.secret"),
    "Scanner excluded .env.secret file",
  );
  assert(
    !scannedBasenames.includes("private.key"),
    "Scanner excluded private.key file",
  );
  assert(
    !scannedBasenames.includes("huge_data.json"),
    "Scanner excluded 1.2 MB oversized file",
  );

  // Clean up temp test directory
  await fs.rm(tempDir, { recursive: true, force: true });

  console.log();
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`SECURITY TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runSecurityTests().catch((error) => {
  console.error("Security test failed:", error);
  process.exitCode = 1;
});
