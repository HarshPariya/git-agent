/**
 * E2E Git Desktop Workflow Test Suite
 * Validates the entire Git Desktop lifecycle against a real repository and remote:
 * 1. Working tree status & staging filters
 * 2. AI semantic change analysis & grouping
 * 3. Atomic Conventional Commit plan execution
 * 4. Verification of commit hashes, log history & clean status
 * 5. Remote push synchronization with bare origin
 * 6. Branch creation & checkout switching
 */

import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  getDetailedChangedFiles,
  analyzeAndPlanCommits,
  executeCommitPlan,
} from "../src/git/change-analyzer.js";

const execAsync = promisify(exec);

async function runE2EWorkflowTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("E2E GIT DESKTOP WORKFLOW & SYNCHRONIZATION TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

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

  const scratchDir = path.resolve(process.cwd(), "scratch", "e2e_git_desktop");
  const remoteBareDir = path.join(scratchDir, "remote.git");
  const localRepoDir = path.join(scratchDir, "local_repo");

  try {
    await fs.rm(scratchDir, { recursive: true, force: true });
  } catch { }
  await fs.mkdir(scratchDir, { recursive: true });

  // 1. Setup bare remote repo
  await execAsync(`git init --bare "${remoteBareDir}"`);
  assert(true, "Bare remote origin initialized successfully");

  // 2. Clone/init local repo
  await execAsync(`git init "${localRepoDir}"`);
  await execAsync('git config user.name "AI Git Desktop Bot"', { cwd: localRepoDir });
  await execAsync('git config user.email "bot@git-desktop.local"', { cwd: localRepoDir });
  await execAsync(`git remote add origin "${remoteBareDir}"`, { cwd: localRepoDir });

  // Initial root commit & push to origin/main
  await fs.writeFile(path.join(localRepoDir, "README.md"), "# Production E2E Workspace\n");
  await execAsync("git add README.md", { cwd: localRepoDir });
  await execAsync('git commit -m "chore(init): initial root commit"', { cwd: localRepoDir });
  await execAsync("git branch -M main", { cwd: localRepoDir });
  await execAsync("git push -u origin main", { cwd: localRepoDir });
  assert(true, "Initial root commit published to origin/main");

  // 3. Create a feature branch
  await execAsync("git checkout -b feature/agent-hardening", { cwd: localRepoDir });
  const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: localRepoDir });
  assert(branchOut.trim() === "feature/agent-hardening", "Switched to branch feature/agent-hardening");

  // 4. Create multi-file changes across distinct modules
  await fs.mkdir(path.join(localRepoDir, "src", "api"), { recursive: true });
  await fs.mkdir(path.join(localRepoDir, "public", "views"), { recursive: true });
  await fs.mkdir(path.join(localRepoDir, "docs"), { recursive: true });

  await fs.writeFile(
    path.join(localRepoDir, "src", "api", "git-controller.ts"),
    "export const gitController = { status: () => 'ok' };\n"
  );
  await fs.writeFile(
    path.join(localRepoDir, "public", "views", "git-desktop.js"),
    "console.log('Git Desktop View v2.0');\n"
  );
  await fs.writeFile(
    path.join(localRepoDir, "docs", "workflows.md"),
    "# Git Workflows\nDescribes commit planning.\n"
  );

  // Stage one file
  await execAsync('git add "src/api/git-controller.ts"', { cwd: localRepoDir });

  // 5. Test Change Analyzer detection
  const changedFiles = await getDetailedChangedFiles(localRepoDir);
  assert(changedFiles.length === 3, `Detected 3 changed files in working tree (found: ${changedFiles.length})`);

  const stagedCount = changedFiles.filter((f) => f.staged).length;
  const unstagedCount = changedFiles.filter((f) => !f.staged).length;
  assert(stagedCount === 1, `Correctly identified 1 staged file (found: ${stagedCount})`);
  assert(unstagedCount === 2, `Correctly identified 2 unstaged/untracked files (found: ${unstagedCount})`);

  // 6. Test AI Semantic Commit Grouping
  const plan = await analyzeAndPlanCommits(localRepoDir);
  assert(plan.groups.length >= 1, `AI Plan created ${plan.groups.length} commit group(s)`);
  assert(plan.totalFiles === 3, `Plan accounts for all 3 changed files`);

  // 7. Execute AI Commit All
  const commitResult = await executeCommitPlan(localRepoDir, plan.groups);
  assert(commitResult.success === true, "executeCommitPlan returned success: true");
  assert(commitResult.totalCreated >= 1, `Successfully created ${commitResult.totalCreated} atomic commit(s)`);
  assert(commitResult.commits.length === commitResult.totalCreated, "Commits array matches totalCreated count");

  // Verify commit hashes exist in git log
  for (const c of commitResult.commits) {
    const { stdout: verifyHash } = await execAsync(`git rev-parse --verify ${c.commitHash}`, { cwd: localRepoDir });
    assert(verifyHash.trim().startsWith(c.commitHash.slice(0, 8)), `Verified commit SHA in git history: ${c.commitHash.slice(0, 7)}`);
  }

  // 8. Verify working tree is clean
  const cleanCheck = await getDetailedChangedFiles(localRepoDir);
  assert(cleanCheck.length === 0, "Working tree is completely clean after Commit All");

  // 9. Push feature branch to origin
  await execAsync("git push -u origin feature/agent-hardening", { cwd: localRepoDir });
  const { stdout: remoteBranches } = await execAsync("git branch -r", { cwd: localRepoDir });
  assert(remoteBranches.includes("origin/feature/agent-hardening"), "Remote contains published feature/agent-hardening branch");

  // 10. Test Branch Switcher (create another branch and verify clean switch)
  await execAsync("git checkout -b feature/hotfix-patch", { cwd: localRepoDir });
  const { stdout: hotfixBranch } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: localRepoDir });
  assert(hotfixBranch.trim() === "feature/hotfix-patch", "Branch switcher switched to feature/hotfix-patch");

  // Cleanup
  try {
    await fs.rm(scratchDir, { recursive: true, force: true });
  } catch { }

  console.log("\n════════════════════════════════════════════════════");
  console.log(`TOTAL PASS: ${passed} | TOTAL FAIL: ${failed}`);
  console.log("════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runE2EWorkflowTests().catch((err) => {
  console.error("E2E Test Suite Error:", err);
  process.exit(1);
});
