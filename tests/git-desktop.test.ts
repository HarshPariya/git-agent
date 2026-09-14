import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getDetailedChangedFiles, analyzeAndPlanCommits, executeCommitPlan } from "../src/git/change-analyzer.js";

const execAsync = promisify(exec);

async function runGitDesktopTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGIT DESKTOP & COMMIT PLAN TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let passed = 0, failed = 0;
  const assert = (condition: boolean, name: string) => { console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`); condition ? passed++ : failed++; };

  // 1. Setup isolated test repository
  const testRepoDir = path.resolve(process.cwd(), "scratch", "test_git_desktop_repo");
  try { await fs.rm(testRepoDir, { recursive: true, force: true }); } catch {}
  await fs.mkdir(testRepoDir, { recursive: true });
  await execAsync("git init", { cwd: testRepoDir });
  await execAsync('git config user.name "Harsh Pariya"', { cwd: testRepoDir });
  await execAsync('git config user.email "hpariya195@gmail.com"', { cwd: testRepoDir });
  await fs.writeFile(path.join(testRepoDir, "README.md"), "# Initial Workspace\n");
  await execAsync("git add README.md", { cwd: testRepoDir });
  await execAsync('git commit -m "chore: initial repository structure"', { cwd: testRepoDir });

  // 2. Create multi-domain changed files
  await fs.mkdir(path.join(testRepoDir, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(testRepoDir, "src", "api"), { recursive: true });
  await fs.mkdir(path.join(testRepoDir, "docs"), { recursive: true });
  await fs.mkdir(path.join(testRepoDir, "tests"), { recursive: true });
  await fs.writeFile(path.join(testRepoDir, "src", "auth", "service.ts"), "export function verifyToken(token: string) { return Boolean(token); }\n");
  await fs.writeFile(path.join(testRepoDir, "src", "api", "routes.ts"), "export const routes = ['/api/v1/health', '/api/v1/user'];\n");
  await fs.writeFile(path.join(testRepoDir, "docs", "guide.md"), "# Quick Start Guide\nFollow setup steps below.\n");
  await fs.writeFile(path.join(testRepoDir, "tests", "auth.test.ts"), "console.log('auth tests');\n");
  await execAsync('git add "src/auth/service.ts"', { cwd: testRepoDir });

  // 3. Test getDetailedChangedFiles
  const changedFiles = await getDetailedChangedFiles(testRepoDir);
  assert(changedFiles.length === 4, `Detected all 4 changed files (found: ${changedFiles.length})`);
  const authFile = changedFiles.find((f) => f.filePath.includes("auth/service.ts"));
  assert(authFile !== undefined, "Found auth/service.ts in changed files");
  assert(authFile?.staged === true, "Detected staged status for auth/service.ts");
  assert(authFile?.risk === "high", "Classified auth file as high risk");
  const docFile = changedFiles.find((f) => f.filePath.includes("docs/guide.md"));
  assert(docFile !== undefined, "Found docs/guide.md in changed files");
  assert(docFile?.risk === "low", "Classified documentation as low risk");
  assert(changedFiles.find((f) => f.filePath.includes("src/api/routes.ts")) !== undefined, "Found src/api/routes.ts");

  // 4. Test analyzeAndPlanCommits
  const commitPlan = await analyzeAndPlanCommits(testRepoDir);
  assert(commitPlan.totalFiles === 4, `Commit plan accounts for all 4 files (total: ${commitPlan.totalFiles})`);
  assert(commitPlan.groups.length >= 2, `Grouped into multiple logical commits (groups: ${commitPlan.groups.length})`);
  assert(typeof commitPlan.summary === "string" && commitPlan.summary.length > 0, "Generated non-empty plan summary");
  for (const grp of commitPlan.groups) {
    assert(Array.isArray(grp.files) && grp.files.length > 0, `Group '${grp.name}' contains valid files`);
    assert(Boolean(grp.suggestedCommit.subject), `Group '${grp.name}' has suggested commit subject`);
    assert(Boolean(grp.suggestedCommit.type), `Group '${grp.name}' has valid commit type`);
    assert(typeof grp.reason === "string", `Group '${grp.name}' provides grouping rationale`);
  }

  // 5. Test executeCommitPlan
  const execResult = await executeCommitPlan(testRepoDir, commitPlan.groups);
  assert(execResult.success === true, "Commit plan executed successfully");
  assert(execResult.totalCreated >= 2, `Created multiple logical commits (created: ${execResult.totalCreated})`);
  for (const c of execResult.commits) {
    assert(Boolean(c.commitHash) && c.commitHash.length >= 7, `Commit '${c.groupName}' has valid SHA: ${c.commitHash}`);
    assert(Boolean(c.commitMessage), `Commit '${c.groupName}' has message`);
  }

  // 6. Verify Git Log
  const { stdout: logOut } = await execAsync("git log -n 5 --oneline", { cwd: testRepoDir });
  assert(logOut.includes("update") || logOut.includes("chore") || logOut.includes("fix"), "Git log reflects new commits");

  // 7. Working Tree clean
  const { stdout: finalStatus } = await execAsync("git status --porcelain", { cwd: testRepoDir });
  assert(finalStatus.trim() === "", "Working tree clean after sequential commit execution");

  try { await fs.rm(testRepoDir, { recursive: true, force: true }); } catch {}
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nGIT DESKTOP TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  if (failed > 0) process.exit(1);
}

runGitDesktopTests().catch((err) => { console.error("Git Desktop test error:", err); process.exit(1); });
