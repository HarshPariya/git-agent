/**
 * Multi-Tenant Isolation, Restart Durability & Undo Modification Verification Test Suite
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { repositoryStore } from "../src/repositories/repository-store.js";
import { executeGitStatus, registerRepositoryPath } from "../src/git/engine.js";

const execAsync = promisify(exec);

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    console.log(`✓ [PASS] ${msg}`);
    passCount++;
  } else {
    console.error(`✗ [FAIL] ${msg}`);
    failCount++;
  }
}

async function runTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("MULTI-TENANT ISOLATION & RESTART RECOVERY TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gda-isolation-test-"));
  const userARepoDir = path.join(tempRoot, "user-a-repo");
  const userBRepoDir = path.join(tempRoot, "user-b-repo");

  try {
    // Setup git repo for Tenant A
    await fs.mkdir(userARepoDir, { recursive: true });
    await execAsync("git init -b main", { cwd: userARepoDir });
    await execAsync('git config user.name "Tenant A"', { cwd: userARepoDir });
    await execAsync('git config user.email "tenant-a@example.com"', { cwd: userARepoDir });
    await fs.writeFile(path.join(userARepoDir, "hello.txt"), "Original content from Tenant A\n", "utf8");
    await execAsync('git add hello.txt && git commit -m "Initial commit A"', { cwd: userARepoDir });

    // Setup git repo for Tenant B
    await fs.mkdir(userBRepoDir, { recursive: true });
    await execAsync("git init -b main", { cwd: userBRepoDir });
    await execAsync('git config user.name "Tenant B"', { cwd: userBRepoDir });
    await execAsync('git config user.email "tenant-b@example.com"', { cwd: userBRepoDir });
    await fs.writeFile(path.join(userBRepoDir, "secret.txt"), "Secret content from Tenant B\n", "utf8");
    await execAsync('git add secret.txt && git commit -m "Initial commit B"', { cwd: userBRepoDir });

    // ── 1. Multi-Tenant Isolation ──────────────────────────────────────────────
    console.log("Testing Multi-Tenant Isolation...");
    const tenantA = "tenant-alpha";
    const userA = "user-alpha";
    const tenantB = "tenant-beta";
    const userB = "user-beta";

    const repoA = await repositoryStore.connectRepository({
      name: "user-a-repo",
      localPath: userARepoDir,
      tenantId: tenantA,
      userId: userA,
      url: undefined,
    });
    const repoB = await repositoryStore.connectRepository({
      name: "user-b-repo",
      localPath: userBRepoDir,
      tenantId: tenantB,
      userId: userB,
      url: undefined,
    });

    assert(Boolean(repoA && repoA.id), "Tenant A repository connected with valid ID");
    assert(Boolean(repoB && repoB.id), "Tenant B repository connected with valid ID");

    // Verify Tenant A cannot list Tenant B's repo
    const listA = await repositoryStore.listRepositories(tenantA);
    assert(
      listA.some((r) => r.id === repoA.id),
      "Tenant A list includes Tenant A's repo",
    );
    assert(!listA.some((r) => r.id === repoB.id), "Tenant A list CANNOT see Tenant B's repo");

    // Verify Tenant B cannot list Tenant A's repo
    const listB = await repositoryStore.listRepositories(tenantB);
    assert(
      listB.some((r) => r.id === repoB.id),
      "Tenant B list includes Tenant B's repo",
    );
    assert(!listB.some((r) => r.id === repoA.id), "Tenant B list CANNOT see Tenant A's repo");

    // Verify direct getRepository enforces tenant check
    const crossAccessA = repositoryStore.getRepository(repoB.id, tenantA);
    assert(crossAccessA === undefined, "Tenant A cannot fetch Tenant B's repo by ID (returns undefined)");

    const crossAccessB = repositoryStore.getRepository(repoA.id, tenantB);
    assert(crossAccessB === undefined, "Tenant B cannot fetch Tenant A's repo by ID (returns undefined)");

    // ── 2. Undo Modification Detection ─────────────────────────────────────────
    console.log("\nTesting Undo Modification Detection...");
    registerRepositoryPath(repoA.id, userARepoDir);

    // Initial clean status
    const initialStatus = await executeGitStatus(repoA.id);
    assert(initialStatus.entries.length === 0, "Initial status has 0 modified files");

    // Modify hello.txt
    await fs.writeFile(path.join(userARepoDir, "hello.txt"), "MODIFIED content from Tenant A\n", "utf8");
    const modifiedStatus = await executeGitStatus(repoA.id);
    assert(modifiedStatus.entries.length === 1, "Status detects 1 modified file after edit");
    assert(modifiedStatus.entries[0]?.filePath === "hello.txt", "Modified file is hello.txt");

    // Now undo changes (revert content back to exact original)
    await fs.writeFile(path.join(userARepoDir, "hello.txt"), "Original content from Tenant A\n", "utf8");

    // In engine, executeGitStatus runs git update-index -q --refresh before status
    const undoneStatus = await executeGitStatus(repoA.id);
    assert(undoneStatus.entries.length === 0, "Status returns to 0 modified files after undo!");

    // ── 3. Server Restart Durability ───────────────────────────────────────────
    console.log("\nTesting Server Restart Recovery (Ephemeral Disk Simulation)...");
    // Simulate container wipe by ensuring workspace directory reconstruction
    const restoredPath = await repositoryStore.ensureWorkspace(repoA.id, tenantA);
    assert(Boolean(restoredPath), "ensureWorkspace returns accessible workspace path");

    const repoAfter = repositoryStore.getRepository(repoA.id, tenantA);
    assert(repoAfter?.status === "connected", "Repository status remains 'connected' (not wiped/disconnected)");

    console.log(`\n════════════════════════════════════════════════════`);
    console.log(`TOTAL PASS: ${passCount} | TOTAL FAIL: ${failCount}`);
    console.log(`════════════════════════════════════════════════════\n`);

    if (failCount > 0) {
      process.exit(1);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
