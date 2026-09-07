import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  classifyOperation,
  isProtectedBranch,
  getProtectedBranchNames,
  executeGitStatus,
  executeGitLog,
  executeGitDiff,
  executeGitBranches,
} from "../src/git/engine.js";
import { executeSafeCommit, formatCommitMessage } from "../src/git/commit.js";
import { validatePrePush } from "../src/git/push.js";
import { ConflictAnalyzer } from "../src/git/conflicts.js";

const execAsync = promisify(exec);

async function runGitEngineTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("GIT ENGINE & SAFETY TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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

  // 1. Operation Classification & Risk Catalog
  const statusOp = classifyOperation("status");
  assert(statusOp.risk === "safe" && statusOp.requiresApproval === false, "Status classified as safe");

  const commitOp = classifyOperation("commit");
  assert(commitOp.risk === "controlled" && commitOp.requiresApproval === true, "Commit classified as controlled");

  const pushOp = classifyOperation("push");
  assert(pushOp.risk === "dangerous" && pushOp.requiresApproval === true, "Push classified as dangerous");

  // 2. Protected Branch Safeguards
  assert(isProtectedBranch("main") === true, "Protects 'main' branch");
  assert(isProtectedBranch("master") === true, "Protects 'master' branch");
  assert(isProtectedBranch("production") === true, "Protects 'production' branch");
  assert(isProtectedBranch("origin/main") === true, "Protects 'origin/main' ref");
  assert(isProtectedBranch("feature/agent-1") === false, "Allows normal feature branch");

  const protectedList = getProtectedBranchNames();
  assert(protectedList.includes("main") && protectedList.includes("release"), "Protected branch list contains expected branches");

  // 3. Conventional Commit Formatter
  const formatted = formatCommitMessage({
    type: "feat",
    scope: "agent",
    subject: "support interactive debugging",
    breakingChange: false,
  });
  assert(formatted === "feat(agent): support interactive debugging", "Formats conventional commit message correctly");

  // 4. Isolated Git Repository Operations
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-engine-test-"));
  try {
    // Initialize git repository
    await execAsync("git init -b main", { cwd: tempDir });
    await execAsync('git config user.name "Harsh Pariya"', { cwd: tempDir });
    await execAsync('git config user.email "hpariya195@gmail.com"', { cwd: tempDir });

    // Initial status on empty repo
    const initialStatus = await executeGitStatus(tempDir);
    assert(initialStatus.clean === true, "Initial repository reports clean");
    assert(initialStatus.branch === "main", "Repository branch detected as 'main'");

    // Create a file and check status
    const testFile = path.join(tempDir, "sample.txt");
    await fs.writeFile(testFile, "Hello Git Debugging Agent\nLine 2\n");
    const dirtyStatus = await executeGitStatus(tempDir);
    assert(dirtyStatus.clean === false, "Dirty working tree correctly detected");
    assert(dirtyStatus.entries.length > 0, "Untracked/modified entries detected");

    // Commit changes safely
    const commitResult = await executeSafeCommit(tempDir, {
      message: "feat: initial test commit",
      stageAll: true,
    });
    assert(commitResult.success === true, "executeSafeCommit succeeded");
    assert(Boolean(commitResult.commitHash), "Commit hash generated");

    // Check git log
    const logEntries = await executeGitLog(tempDir, { count: 5 });
    assert(logEntries.length === 1, "Git log returns committed entry");
    assert(logEntries[0]?.author === "Harsh Pariya", "Commit author matches Harsh Pariya");
    assert(logEntries[0]?.message.includes("initial test commit") === true, "Commit message preserved");

    // Modify file and test diff
    await fs.appendFile(testFile, "Line 3 added\n");
    const diffEntries = await executeGitDiff(tempDir);
    assert(diffEntries.length > 0, "executeGitDiff detects file modifications");

    // Test branches
    const branches = await executeGitBranches(tempDir);
    assert(branches.some((b) => b.name === "main"), "executeGitBranches lists main branch");

    // 5. Test Push Safeguard to Protected Branch
    const pushCheckProtected = await validatePrePush(tempDir, {
      branch: "main",
      force: true,
    });
    assert(
      pushCheckProtected.canPush === false,
      "validatePrePush rejects force-push to protected branch",
    );

    const pushCheckNormal = await validatePrePush(tempDir, {
      branch: "feature/test",
      force: false,
    });
    assert(
      pushCheckNormal.canPush === true,
      "validatePrePush allows safe push to feature branch",
    );

    // 6. Conflict Analyzer
    const conflictAnalyzer = new ConflictAnalyzer();
    const conflictReport = await conflictAnalyzer.analyzeRepository(tempDir);
    assert(conflictReport.totalConflicts === 0, "Conflict analyzer reports zero conflicts on clean repo");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`GIT ENGINE TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runGitEngineTests().catch((err) => {
  console.error("Git Engine test failed:", err);
  process.exitCode = 1;
});
