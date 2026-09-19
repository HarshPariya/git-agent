import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getDetailedChangedFiles, analyzeAndPlanCommits, executeCommitPlan } from "../src/git/change-analyzer.js";

const execAsync = promisify(exec);

async function runE2EWorkflowTests() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nE2E GIT DESKTOP WORKFLOW & SYNCHRONIZATION TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0,
    failed = 0;
  const assert = (condition: boolean, name: string) => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? passed++ : failed++;
  };

  const scratchDir = path.resolve(process.cwd(), "scratch", "e2e_git_desktop");
  const remoteBareDir = path.join(scratchDir, "remote.git");
  const localRepoDir = path.join(scratchDir, "local_repo");

  try {
    await fs.rm(scratchDir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(scratchDir, { recursive: true });

  // 1. Setup bare remote
  await execAsync(`git init --bare "${remoteBareDir}"`);
  assert(true, "Bare remote origin initialized successfully");

  // 2. Clone/init local repo
  await execAsync(`git init "${localRepoDir}"`);
  await execAsync('git config user.name "AI Git Desktop Bot"', { cwd: localRepoDir });
  await execAsync('git config user.email "bot@git-desktop.local"', { cwd: localRepoDir });
  await execAsync(`git remote add origin "${remoteBareDir}"`, { cwd: localRepoDir });
  await fs.writeFile(path.join(localRepoDir, "README.md"), "# Production E2E Workspace\n");
  await execAsync("git add README.md", { cwd: localRepoDir });
  await execAsync('git commit -m "chore(init): initial root commit"', { cwd: localRepoDir });
  await execAsync("git branch -M main", { cwd: localRepoDir });
  await execAsync("git push -u origin main", { cwd: localRepoDir });
  assert(true, "Initial root commit published to origin/main");

  // 3. Create feature branch
  await execAsync("git checkout -b feature/agent-hardening", { cwd: localRepoDir });
  const { stdout: branchOut } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: localRepoDir });
  assert(branchOut.trim() === "feature/agent-hardening", "Switched to branch feature/agent-hardening");

  // 4. Create multi-file changes
  await fs.mkdir(path.join(localRepoDir, "src", "api"), { recursive: true });
  await fs.mkdir(path.join(localRepoDir, "public", "views"), { recursive: true });
  await fs.mkdir(path.join(localRepoDir, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(localRepoDir, "src", "api", "git-controller.ts"),
    "export const gitController = { status: () => 'ok' };\n",
  );
  await fs.writeFile(
    path.join(localRepoDir, "public", "views", "debugging.js"),
    "console.log('AI Debugging View v2.0');\n",
  );
  await fs.writeFile(path.join(localRepoDir, "docs", "workflows.md"), "# Git Workflows\nDescribes commit planning.\n");
  await execAsync('git add "src/api/git-controller.ts"', { cwd: localRepoDir });

  // 5. Change Analyzer detection
  const changedFiles = await getDetailedChangedFiles(localRepoDir);
  assert(changedFiles.length === 3, `Detected 3 changed files (found: ${changedFiles.length})`);
  assert(changedFiles.filter((f) => f.staged).length === 1, "Correctly identified 1 staged file");
  assert(changedFiles.filter((f) => !f.staged).length === 2, "Correctly identified 2 unstaged files");

  // 6. AI Semantic Commit Grouping
  const plan = await analyzeAndPlanCommits(localRepoDir);
  assert(plan.groups.length >= 1, `AI Plan created ${plan.groups.length} commit group(s)`);
  assert(plan.totalFiles === 3, "Plan accounts for all 3 changed files");

  // 7. Execute AI Commit All
  const commitResult = await executeCommitPlan(localRepoDir, plan.groups);
  assert(commitResult.success === true, "executeCommitPlan returned success: true");
  assert(commitResult.totalCreated >= 1, `Successfully created ${commitResult.totalCreated} atomic commit(s)`);
  assert(commitResult.commits.length === commitResult.totalCreated, "Commits array matches totalCreated count");

  for (const c of commitResult.commits) {
    const { stdout: verifyHash } = await execAsync(`git rev-parse --verify ${c.commitHash}`, { cwd: localRepoDir });
    assert(verifyHash.trim().startsWith(c.commitHash.slice(0, 8)), `Verified commit SHA: ${c.commitHash.slice(0, 7)}`);
  }

  // 8. Working tree clean
  const cleanCheck = await getDetailedChangedFiles(localRepoDir);
  assert(cleanCheck.length === 0, "Working tree is completely clean after Commit All");

  // 9. Push feature branch
  await execAsync("git push -u origin feature/agent-hardening", { cwd: localRepoDir });
  const { stdout: remoteBranches } = await execAsync("git branch -r", { cwd: localRepoDir });
  assert(remoteBranches.includes("origin/feature/agent-hardening"), "Remote contains feature/agent-hardening branch");

  // 10. Branch Switcher
  await execAsync("git checkout -b feature/hotfix-patch", { cwd: localRepoDir });
  const { stdout: hotfixBranch } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: localRepoDir });
  assert(hotfixBranch.trim() === "feature/hotfix-patch", "Branch switcher switched to feature/hotfix-patch");

  try {
    await fs.rm(scratchDir, { recursive: true, force: true });
  } catch {}
  console.log(
    `\n════════════════════════════════════════════════════\nTOTAL PASS: ${passed} | TOTAL FAIL: ${failed}\n════════════════════════════════════════════════════\n`,
  );
  if (failed > 0) process.exit(1);
  else process.exit(0);
}

runE2EWorkflowTests().catch((err) => {
  console.error("E2E Test Suite Error:", err);
  process.exit(1);
});
