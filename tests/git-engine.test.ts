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
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGIT ENGINE & SAFETY TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0,
    failed = 0;
  const assert = (condition: boolean, name: string) => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? passed++ : failed++;
  };

  // 1. Operation Classification
  assert(
    classifyOperation("status").risk === "safe" && classifyOperation("status").requiresApproval === false,
    "Status classified as safe",
  );
  assert(
    classifyOperation("commit").risk === "controlled" && classifyOperation("commit").requiresApproval === true,
    "Commit classified as controlled",
  );
  assert(
    classifyOperation("push").risk === "dangerous" && classifyOperation("push").requiresApproval === true,
    "Push classified as dangerous",
  );

  // 2. Protected Branch Safeguards
  assert(isProtectedBranch("main") === true, "Protects 'main' branch");
  assert(isProtectedBranch("master") === true, "Protects 'master' branch");
  assert(isProtectedBranch("production") === true, "Protects 'production' branch");
  assert(isProtectedBranch("origin/main") === true, "Protects 'origin/main' ref");
  assert(isProtectedBranch("feature/agent-1") === false, "Allows normal feature branch");
  const protectedList = getProtectedBranchNames();
  assert(
    protectedList.includes("main") && protectedList.includes("release"),
    "Protected branch list contains expected branches",
  );

  // 3. Conventional Commit Formatter
  assert(
    formatCommitMessage({
      type: "feat",
      scope: "agent",
      subject: "support interactive debugging",
      breakingChange: false,
    }) === "feat(agent): support interactive debugging",
    "Formats conventional commit message correctly",
  );

  // 4. Isolated Git Repository Operations
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "git-engine-test-"));
  try {
    await execAsync("git init -b main", { cwd: tempDir });
    await execAsync('git config user.name "Harsh Pariya"', { cwd: tempDir });
    await execAsync('git config user.email "hpariya195@gmail.com"', { cwd: tempDir });

    const initialStatus = await executeGitStatus(tempDir);
    assert(initialStatus.clean === true, "Initial repository reports clean");
    assert(initialStatus.branch === "main", "Repository branch detected as 'main'");

    const testFile = path.join(tempDir, "sample.txt");
    await fs.writeFile(testFile, "Hello Git Debugging Agent\nLine 2\n");
    const dirtyStatus = await executeGitStatus(tempDir);
    assert(dirtyStatus.clean === false, "Dirty working tree correctly detected");
    assert(dirtyStatus.entries.length > 0, "Untracked/modified entries detected");

    const commitResult = await executeSafeCommit(tempDir, { message: "feat: initial test commit", stageAll: true });
    assert(commitResult.success === true, "executeSafeCommit succeeded");
    assert(Boolean(commitResult.commitHash), "Commit hash generated");

    const logEntries = await executeGitLog(tempDir, { count: 5 });
    assert(logEntries.length === 1, "Git log returns committed entry");
    assert(logEntries[0]?.author === "Harsh Pariya", "Commit author matches");
    assert(logEntries[0]?.message.includes("initial test commit") === true, "Commit message preserved");

    await fs.appendFile(testFile, "Line 3 added\n");
    assert((await executeGitDiff(tempDir)).length > 0, "executeGitDiff detects file modifications");
    assert(
      (await executeGitBranches(tempDir)).some((b) => b.name === "main"),
      "executeGitBranches lists main branch",
    );

    // 5. Push Safeguard
    assert(
      (await validatePrePush(tempDir, { branch: "main", force: true })).canPush === false,
      "validatePrePush rejects force-push to protected branch",
    );
    assert(
      (await validatePrePush(tempDir, { branch: "feature/test", force: false })).canPush === true,
      "validatePrePush allows safe push to feature branch",
    );

    // 6. Conflict Analyzer
    const conflictReport = await new ConflictAnalyzer().analyzeRepository(tempDir);
    assert(conflictReport.totalConflicts === 0, "Conflict analyzer reports zero conflicts on clean repo");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGIT ENGINE TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

runGitEngineTests()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("Git Engine test failed:", err);
    process.exit(1);
  });
