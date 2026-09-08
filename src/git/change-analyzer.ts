import { callLlm, isLlmAvailable } from "../llm/client.js";
import { formatCommitMessage, type ConventionalCommit } from "./commit.js";
import { getExecutionPath } from "./engine.js";
import { safeExec } from "./utils.js";

export interface ChangedFileDetail {
  filePath: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  additions: number;
  deletions: number;
  risk: "low" | "medium" | "high";
  logicalGroup?: string;
  summary?: string;
}

export interface LogicalChangeGroup {
  id: string; name: string; reason: string; risk: "low" | "medium" | "high";
  files: string[]; suggestedCommit: ConventionalCommit; testCount: number;
}

export interface CommitPlan {
  summary: string; totalFiles: number; totalCommits: number;
  groups: LogicalChangeGroup[]; changedFiles: ChangedFileDetail[];
}

export interface ExecutedCommitResult {
  groupId: string; groupName: string; commitHash: string;
  commitMessage: string; files: string[];
}

export interface CommitPlanExecutionResult {
  success: boolean; commits: ExecutedCommitResult[]; totalCreated: number;
  branch: string; message: string; error?: string;
}

export async function getDetailedChangedFiles(repoPath: string): Promise<ChangedFileDetail[]> {
  const targetPath = getExecutionPath(repoPath);
  const { stdout: statusOut } = await safeExec("git status --porcelain -uall", targetPath);
  if (!statusOut.trim()) return [];

  const numstatMap = new Map<string, { additions: number; deletions: number }>();
  try {
    const { stdout: numstatOut } = await safeExec("git diff --numstat HEAD", targetPath);
    for (const line of numstatOut.trim().split("\n")) {
      if (!line) continue;
      const [addStr, delStr, file] = line.split(/\s+/);
      if (file) numstatMap.set(file.trim(), { additions: parseInt(addStr ?? "0", 10) || 0, deletions: parseInt(delStr ?? "0", 10) || 0 });
    }
  } catch {
    try {
      const { stdout: numstatOut } = await safeExec("git diff --numstat", targetPath);
      for (const line of numstatOut.trim().split("\n")) {
        if (!line) continue;
        const [addStr, delStr, file] = line.split(/\s+/);
        if (file) numstatMap.set(file.trim(), { additions: parseInt(addStr ?? "0", 10) || 0, deletions: parseInt(delStr ?? "0", 10) || 0 });
      }
    } catch { }
  }

  const results: ChangedFileDetail[] = [];
  for (const line of statusOut.trim().split("\n")) {
    if (!line || line.length < 3) continue;
    const indexCode = line.charAt(0);
    const workCode = line.charAt(1);
    const rawPath = line.substring(3).trim().replace(/^"|"$/g, "");

    let status: ChangedFileDetail["status"] = "modified";
    if (indexCode === "?" || workCode === "?") status = "untracked";
    else if (indexCode === "A" || workCode === "A") status = "added";
    else if (indexCode === "D" || workCode === "D") status = "deleted";
    else if (indexCode === "R" || workCode === "R") status = "renamed";

    const isStaged = indexCode !== " " && indexCode !== "?";
    const stats = numstatMap.get(rawPath) || { additions: status === "added" || status === "untracked" ? 1 : 0, deletions: 0 };

    let risk: ChangedFileDetail["risk"] = "low";
    const lower = rawPath.toLowerCase();
    if (lower.includes("security") || lower.includes("auth") || lower.includes("key") || lower.includes("pass") || lower.includes("secret")) risk = "high";
    else if (lower.includes("config") || lower.includes("route") || lower.includes("schema") || lower.includes("db") || lower.includes("migration")) risk = "medium";

    results.push({ filePath: rawPath, status, staged: isStaged, additions: stats.additions, deletions: stats.deletions, risk });
  }
  return results;
}

function groupFilesHeuristically(files: ChangedFileDetail[]): LogicalChangeGroup[] {
  const groupsMap = new Map<string, { name: string; files: string[]; risk: "low" | "medium" | "high"; type: ConventionalCommit["type"]; scope: string; reason: string }>();

  for (const file of files) {
    const p = file.filePath.toLowerCase();
    let groupKey = "core", groupName = "Core Implementation", type: ConventionalCommit["type"] = "fix", scope = "core", reason = "Core application source updates";

    if (p.startsWith("test") || p.includes(".test.") || p.includes(".spec.")) { groupKey = "tests"; groupName = "Automated Tests"; type = "test"; scope = "tests"; reason = "Unit and integration test suites coverage"; }
    else if (p.startsWith("doc") || p.endsWith(".md") || p.endsWith(".txt")) { groupKey = "docs"; groupName = "Documentation"; type = "docs"; scope = "docs"; reason = "Documentation, guide, and specifications updates"; }
    else if (p.includes("auth") || p.includes("security") || p.includes("guardrail")) { groupKey = "security"; groupName = "Authentication & Security"; type = "fix"; scope = "auth"; reason = "Security, guardrail, or authentication controls"; }
    else if (p.includes("git") || p.includes("branch") || p.includes("commit") || p.includes("push")) { groupKey = "git"; groupName = "Git Operations"; type = "feat"; scope = "git"; reason = "Git engine, conflict resolution, or repository management"; }
    else if (p.includes("api") || p.includes("route") || p.includes("server") || p.includes("app.ts")) { groupKey = "api"; groupName = "API & Routing"; type = "feat"; scope = "api"; reason = "API endpoint routing and service interface updates"; }
    else if (p.includes("public") || p.endsWith(".html") || p.endsWith(".css") || p.includes("ui")) { groupKey = "ui"; groupName = "User Interface"; type = "feat"; scope = "ui"; reason = "Frontend UI components, styling, and client views"; }

    const existing = groupsMap.get(groupKey);
    if (existing) { existing.files.push(file.filePath); if (file.risk === "high") existing.risk = "high"; else if (file.risk === "medium" && existing.risk !== "high") existing.risk = "medium"; }
    else groupsMap.set(groupKey, { name: groupName, files: [file.filePath], risk: file.risk, type, scope, reason });
  }

  const result: LogicalChangeGroup[] = [];
  let index = 1;
  for (const [_key, val] of groupsMap.entries()) {
    result.push({
      id: `group-${index}`, name: val.name, reason: val.reason, risk: val.risk, files: val.files,
      testCount: val.type === "test" ? val.files.length : Math.max(1, Math.floor(val.files.length * 1.5)),
      suggestedCommit: { type: val.type, scope: val.scope, subject: `update ${val.scope} components (${val.files.length} file${val.files.length > 1 ? "s" : ""})`, body: `Covers changes across:\n${val.files.map((f) => `- ${f}`).join("\n")}`, breakingChange: false },
    });
    index++;
  }
  return result;
}

export async function analyzeAndPlanCommits(repoPath: string): Promise<CommitPlan> {
  const targetPath = getExecutionPath(repoPath);
  const changedFiles = await getDetailedChangedFiles(targetPath);
  if (changedFiles.length === 0) return { summary: "Working tree is clean. No changed files to analyze.", totalFiles: 0, totalCommits: 0, groups: [], changedFiles: [] };

  if (await isLlmAvailable()) {
    try {
      const fileListSummary = changedFiles.map((f) => `- ${f.filePath} (${f.status}, +${f.additions}/-${f.deletions}, risk: ${f.risk})`).join("\n");
      const prompt = `You are a Senior Staff Git Architect.\nAnalyze these ${changedFiles.length} changed files:\n${fileListSummary}\n\nGroup into 1-4 logical change groups. Rules:\n1. Every file MUST appear in exactly one group.\n2. Use EXACT file paths.\n3. Valid Conventional Commit types only.\n\nRespond ONLY with JSON:\n{"summary":"...","groups":[{"id":"group-1","name":"...","reason":"...","risk":"low"|"medium"|"high","files":["..."],"commitType":"feat"|"fix"|"docs"|"test"|"refactor"|"chore","commitScope":"...","commitSubject":"...","commitBody":"...","testCount":2}]}`;
      const response = await callLlm([{ role: "system", content: "You are an expert Git automation engine. Output valid JSON only." }, { role: "user", content: prompt }]);
      const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed.groups) && parsed.groups.length > 0) {
          const validPathSet = new Set(changedFiles.map((f) => f.filePath));
          const assignedFiles = new Set<string>();
          const validGroups: LogicalChangeGroup[] = [];

          for (let idx = 0; idx < parsed.groups.length; idx++) {
            const g = parsed.groups[idx];
            if (!Array.isArray(g.files)) continue;
            const groupFiles = g.files.filter((fp: string) => {
              const matched = validPathSet.has(fp);
              if (matched && !assignedFiles.has(fp)) { assignedFiles.add(fp); return true; }
              return false;
            });
            if (groupFiles.length > 0) {
              validGroups.push({
                id: g.id || `group-${idx + 1}`, name: g.name || `Logical Change ${idx + 1}`, reason: g.reason || "Semantically cohesive file changes",
                risk: g.risk === "high" || g.risk === "medium" ? g.risk : "low", files: groupFiles,
                testCount: typeof g.testCount === "number" ? g.testCount : 1,
                suggestedCommit: { type: g.commitType || "fix", scope: g.commitScope || undefined, subject: (g.commitSubject || "apply updates").slice(0, 72), body: g.commitBody || undefined, breakingChange: false },
              });
            }
          }

          const unassigned = changedFiles.filter((f) => !assignedFiles.has(f.filePath));
          const firstGroup = validGroups[0];
          if (unassigned.length > 0 && firstGroup) { for (const uf of unassigned) { firstGroup.files.push(uf.filePath); assignedFiles.add(uf.filePath); } }

          if (validGroups.length > 0 && assignedFiles.size === changedFiles.length) {
            for (const group of validGroups) {
              for (const f of group.files) { const matched = changedFiles.find((cf) => cf.filePath === f); if (matched) { matched.logicalGroup = group.name; matched.summary = group.suggestedCommit.subject; } }
            }
            return { summary: parsed.summary || `${changedFiles.length} changed files grouped into ${validGroups.length} logical commits.`, totalFiles: changedFiles.length, totalCommits: validGroups.length, groups: validGroups, changedFiles };
          }
        }
      }
    } catch { }
  }

  const heuristicGroups = groupFilesHeuristically(changedFiles);
  for (const group of heuristicGroups) {
    for (const f of group.files) { const matched = changedFiles.find((cf) => cf.filePath === f); if (matched) { matched.logicalGroup = group.name; matched.summary = group.suggestedCommit.subject; } }
  }
  return { summary: `${changedFiles.length} changed files organized into ${heuristicGroups.length} logical change groups.`, totalFiles: changedFiles.length, totalCommits: heuristicGroups.length, groups: heuristicGroups, changedFiles };
}

export async function executeCommitPlan(
  repoPath: string, groups: LogicalChangeGroup[],
): Promise<CommitPlanExecutionResult> {
  const targetPath = getExecutionPath(repoPath);
  const { stdout: initialStatus } = await safeExec("git status --porcelain", targetPath);
  if (!initialStatus.trim()) return { success: false, commits: [], totalCreated: 0, branch: "unknown", message: "Nothing to commit — working tree is clean." };

  let currentBranch = "main";
  try { const { stdout: branchOut } = await safeExec("git rev-parse --abbrev-ref HEAD", targetPath); currentBranch = branchOut.trim() || "main"; } catch { }

  try { await safeExec("git reset HEAD", targetPath); } catch { }

  const executedCommits: ExecutedCommitResult[] = [];
  for (const group of groups) {
    if (!group.files || group.files.length === 0) continue;
    for (const file of group.files) { try { await safeExec(`git add "${file}"`, targetPath); } catch (err: any) { console.warn(`[ChangeAnalyzer] Failed to stage file ${file}:`, err.message); } }

    const { stdout: stagedCheck } = await safeExec("git diff --cached --name-only", targetPath);
    if (!stagedCheck.trim()) continue;

    const msg = formatCommitMessage(group.suggestedCommit);
    const escapedMsg = msg.replace(/"/g, '\\"').replace(/`/g, "\\`");
    try {
      const { stdout: commitOut } = await safeExec(`git commit -m "${escapedMsg}"`, targetPath);
      let sha = "";
      const hashMatch = /\[(?:.+?\s+)?([a-f0-9]{7,40})\]/.exec(commitOut);
      if (hashMatch && hashMatch[1]) sha = hashMatch[1];
      else { const { stdout: revOut } = await safeExec("git rev-parse --short HEAD", targetPath); sha = revOut.trim(); }
      executedCommits.push({ groupId: group.id, groupName: group.name, commitHash: sha, commitMessage: group.suggestedCommit.subject, files: group.files });
    } catch (err: any) {
      return { success: false, commits: executedCommits, totalCreated: executedCommits.length, branch: currentBranch, message: `Commit for group '${group.name}' failed.`, error: err.message };
    }
  }
  return { success: true, commits: executedCommits, totalCreated: executedCommits.length, branch: currentBranch, message: `Successfully executed ${executedCommits.length} logical commits on branch '${currentBranch}'.` };
}
