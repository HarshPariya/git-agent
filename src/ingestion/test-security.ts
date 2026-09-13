import fs from "node:fs/promises";
import path from "node:path";
import { isSecretFile, isPathWithinRoot, isIgnoredFile, MAX_FILE_SIZE_BYTES } from "./cleaner.js";
import { scanRepository } from "./parser.js";

const runSecurityTests = async () => {
  console.warn("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nINGESTION & RETRIEVAL SECURITY TESTS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let passed = 0;
  let failed = 0;
  const assert = (ok: boolean, name: string) => {
    console.warn(ok ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    if (ok) { passed++; } else { failed++; }
  };

  const tempDir = path.join(process.cwd(), "scratch", "security_test_repo");

  try {
    // 1. Secret & Credentials Exclusion
    assert(isSecretFile(".env") === true, "Filters .env file");
    assert(isSecretFile(".env.production") === true, "Filters .env.production file");
    assert(isSecretFile("id_rsa") === true, "Filters SSH private key id_rsa");
    assert(isSecretFile("server.pem") === true, "Filters PEM certificate server.pem");
    assert(isSecretFile("database.key") === true, "Filters database.key");
    assert(isSecretFile("credentials.json") === true, "Filters credentials.json");
    assert(isSecretFile("app.ts") === false, "Allows normal app.ts file");

    // 2. Lockfiles & Artifact Exclusion
    assert(isIgnoredFile("package-lock.json") === true, "Filters package-lock.json");
    assert(isIgnoredFile("pnpm-lock.yaml") === true, "Filters pnpm-lock.yaml");

    // 3. Path Traversal Safety
    const rootDir = process.cwd();
    assert(
      isPathWithinRoot(path.resolve(rootDir, "..", "outside.ts"), rootDir) === false,
      "Blocks out-of-root path traversal",
    );
    assert(
      isPathWithinRoot(path.resolve(rootDir, "src", "app.ts"), rootDir) === true,
      "Allows valid path within repository root",
    );

    // 4. End-to-End Temp Directory Scan
    await fs.mkdir(tempDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(tempDir, "valid_code.ts"), "export function hello() { return 'world'; }"),
      fs.writeFile(path.join(tempDir, ".env.secret"), "API_KEY=SECRET_12345"),
      fs.writeFile(path.join(tempDir, "private.key"), "-----BEGIN PRIVATE KEY-----"),
      fs.writeFile(path.join(tempDir, "huge_data.json"), Buffer.alloc(MAX_FILE_SIZE_BYTES + 200, "x")),
    ]);

    const scannedBasenames = (await scanRepository(tempDir)).map((f) => path.basename(f));
    assert(scannedBasenames.includes("valid_code.ts"), "Scanner included valid code file");
    assert(!scannedBasenames.includes(".env.secret"), "Scanner excluded .env.secret file");
    assert(!scannedBasenames.includes("private.key"), "Scanner excluded private.key file");
    assert(!scannedBasenames.includes("huge_data.json"), "Scanner excluded 1.2 MB oversized file");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });

    console.warn(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSECURITY TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    if (failed > 0) process.exitCode = 1;
  }
};

runSecurityTests().catch((error) => {
  console.error("Security test failed:", error);
  process.exitCode = 1;
});
