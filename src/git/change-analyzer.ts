/**
 * AI Change Analyzer & Commit Plan Engine
 * Inspects repository working tree diffs, groups files into logical semantic changes,
 * generates Conventional Commit messages via Groq/LLM, and executes sequential commits.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { callLlm, isLlmAvailable } from "../llm/client.js";
import { formatCommitMessage, type ConventionalCommit } from "./commit.js";
import { getExecutionPath } from "./engine.js";

const execAsync = promisify(exec);

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
  id: string;
  name: string;
  reason: string;
  risk: "low" | "medium" | "high";
  files: string[];
  suggestedCommit: ConventionalCommit;
  testCount: number;
}

export interface CommitPlan {
  summary: string;
  totalFiles: number;
  totalCommits: number;
  groups: LogicalChangeGroup[];
  changedFiles: ChangedFileDetail[];
}

export interface ExecutedCommitResult {
  groupId: string;
  groupName: string;
  commitHash: string;
  commitMessage: string;
  files: string[];
}

export interface CommitPlanExecutionResult {
  success: boolean;
  commits: ExecutedCommitResult[];
  totalCreated: number;
  branch: string;
  message: string;
  error?: string;
}

const safeExec = async (
  cmd: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> => {
  return execAsync(cmd, { cwd, timeout: 45_000 });
};

/**
 * Scan repository for all modified, added, deleted, renamed, and untracked files
 * along with their +/- line statistics.
 */
export async function getDetailedChangedFiles(repoPath: string): Promise<ChangedFileDetail[]> {
  const targetPath = getExecutionPath(repoPath);
  const { stdout: statusOut } = await safeExec("git status --porcelain -uall", targetPath);
  if (!statusOut.trim()) return [];

  // Get diff line counts for tracked files
  const numstatMap = new Map<string, { additions: number; deletions: number }>();
  try {
    const { stdout: numstatOut } = await safeExec("git diff --numstat HEAD", targetPath);
    for (const line of numstatOut.trim().split("\n")) {
      if (!line) continue;
      const [addStr, delStr, file] = line.split(/\s+/);
      if (file) {
        numstatMap.set(file.trim(), {
          additions: parseInt(addStr ?? "0", 10) || 0,
          deletions: parseInt(delStr ?? "0", 10) || 0,
        });
      }
    }
  } catch {
    // If no commits yet on HEAD, compare without HEAD
    try {
      const { stdout: numstatOut } = await safeExec("git diff --numstat", targetPath);
      for (const line of numstatOut.trim().split("\n")) {
        if (!line) continue;
        const [addStr, delStr, file] = line.split(/\s+/);
        if (file) {
          numstatMap.set(file.trim(), {
            additions: parseInt(addStr ?? "0", 10) || 0,
            deletions: parseInt(delStr ?? "0", 10) || 0,
          });
        }
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

    // Calculate risk
    let risk: ChangedFileDetail["risk"] = "low";
    const lower = rawPath.toLowerCase();
    if (lower.includes("security") || lower.includes("auth") || lower.includes("key") || lower.includes("pass") || lower.includes("secret")) {
      risk = "high";
    } else if (lower.includes("config") || lower.includes("route") || lower.includes("schema") || lower.includes("db") || lower.includes("migration")) {
      risk = "medium";
    }

    results.push({
      filePath: rawPath,
      status,
      staged: isStaged,
      additions: stats.additions,
      deletions: stats.deletions,
      risk,
    });
  }

  return results;
}

/**
 * Heuristic semantic grouping fallback when LLM is unavailable
 */
function groupFilesHeuristically(files: ChangedFileDetail[]): LogicalChangeGroup[] {
  const groupsMap = new Map<string, { name: string; files: string[]; risk: "low" | "medium" | "high"; type: ConventionalCommit["type"]; scope: string; reason: string }>();

  for (const file of files) {
    const p = file.filePath.toLowerCase();
    let groupKey = "core";
    let groupName = "Core Implementation";
    let type: ConventionalCommit["type"] = "fix";
    let scope = "core";
    let reason = "Core application source updates";

    if (p.startsWith("test") || p.includes(".test.") || p.includes(".spec.")) {
      groupKey = "tests";
      groupName = "Automated Tests";
      type = "test";
      scope = "tests";
      reason = "Unit and integration test suites coverage";
    } else if (p.startsWith("doc") || p.endsWith(".md") || p.endsWith(".txt")) {
      groupKey = "docs";
      groupName = "Documentation";
      type = "docs";
      scope = "docs";
      reason = "Documentation, guide, and specifications updates";
    } else if (p.includes("auth") || p.includes("security") || p.includes("guardrail")) {
      groupKey = "security";
      groupName = "Authentication & Security";
      type = "fix";
      scope = "auth";
      reason = "Security, guardrail, or authentication controls";
    } else if (p.includes("git") || p.includes("branch") || p.includes("commit") || p.includes("push")) {
      groupKey = "git";
      groupName = "Git Operations";
      type = "feat";
      scope = "git";
      reason = "Git engine, conflict resolution, or repository management";
    } else if (p.includes("api") || p.includes("route") || p.includes("server") || p.includes("app.ts")) {
      groupKey = "api";
      groupName = "API & Routing";
      type = "feat";
      scope = "api";
      reason = "API endpoint routing and service interface updates";
    } else if (p.includes("public") || p.endsWith(".html") || p.endsWith(".css") || p.includes("ui")) {
      groupKey = "ui";
      groupName = "User Interface";
      type = "feat";
      scope = "ui";
      reason = "Frontend UI components, styling, and client views";
    }

    const existing = groupsMap.get(groupKey);
    if (existing) {
      existing.files.push(file.filePath);
      if (file.risk === "high") existing.risk = "high";
      else if (file.risk === "medium" && existing.risk !== "high") existing.risk = "medium";
    } else {
      groupsMap.set(groupKey, {
        name: groupName,
        files: [file.filePath],
        risk: file.risk,
        type,
        scope,
        reason,
      });
    }
  }

  const result: LogicalChangeGroup[] = [];
  let index = 1;
  for (const [_key, val] of groupsMap.entries()) {
    result.push({
      id: `group-${index}`,
      name: val.name,
      reason: val.reason,
      risk: val.risk,
      files: val.files,
      testCount: val.type === "test" ? val.files.length : Math.max(1, Math.floor(val.files.length * 1.5)),
      suggestedCommit: {
        type: val.type,
        scope: val.scope,
        subject: `update ${val.scope} components (${val.files.length} file${val.files.length > 1 ? "s" : ""})`,
        body: `Covers changes across:\n${val.files.map((f) => `- ${f}`).join("\n")}`,
        breakingChange: false,
      },
    });
    index++;
  }

  return result;
}

/**
 * Analyze changed files using Groq/LLM semantic intelligence with GraphRAG context
 */
export async function analyzeAndPlanCommits(repoPath: string): Promise<CommitPlan> {
  const targetPath = getExecutionPath(repoPath);
  const changedFiles = await getDetailedChangedFiles(targetPath);

  if (changedFiles.length === 0) {
    return {
      summary: "Working tree is clean. No changed files to analyze.",
      totalFiles: 0,
      totalCommits: 0,
      groups: [],
      changedFiles: [],
    };
  }

  // Check if LLM is available for smart clustering
  if (await isLlmAvailable()) {
    try {
      const fileListSummary = changedFiles
        .map((f) => `- ${f.filePath} (${f.status}, +${f.additions}/-${f.deletions}, risk: ${f.risk})`)
        .join("\n");

      const prompt = `You are a Senior Staff Git Architect.
Analyze these ${changedFiles.length} changed files from a Git repository:
${fileListSummary}

Group these files into 1 to 4 logical, cohesive change groups (DO NOT group everything into one commit if they belong to different functional areas, e.g. auth, api, docs, tests).
CRITICAL RULES:
1. Every file from the list above MUST appear in exactly one group in the "files" array.
2. Use the EXACT file paths provided above. Do NOT invent, truncate, or alter file names.
3. Every group must have a valid Conventional Commit type ("fix", "feat", "docs", "test", "refactor", "chore").

Respond ONLY with valid JSON in this format:
{
  "summary": "Short overall summary explaining the groupings",
  "groups": [
    {
      "id": "group-1",
      "name": "Area Name",
      "reason": "Brief explanation why these files belong together",
      "risk": "low" | "medium" | "high",
      "files": ["exact/path/from/above"],
      "commitType": "feat" | "fix" | "docs" | "test" | "refactor" | "chore",
      "commitScope": "scope-name",
      "commitSubject": "imperative commit message under 72 chars",
      "commitBody": "concise description of what changed",
      "testCount": 2
    }
  ]
}`;

      const response = await callLlm([
        { role: "system", content: "You are an expert Git automation engine. Output valid JSON only, using exact file paths from the input." },
        { role: "user", content: prompt },
      ]);

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

            // Only retain files that actually exist in changedFiles
            const groupFiles = g.files.filter((fp: string) => {
              const matched = validPathSet.has(fp);
              if (matched && !assignedFiles.has(fp)) {
                assignedFiles.add(fp);
                return true;
              }
              return false;
            });

            if (groupFiles.length > 0) {
              validGroups.push({
                id: g.id || `group-${idx + 1}`,
                name: g.name || `Logical Change ${idx + 1}`,
                reason: g.reason || "Semantically cohesive file changes",
                risk: g.risk === "high" || g.risk === "medium" ? g.risk : "low",
                files: groupFiles,
                testCount: typeof g.testCount === "number" ? g.testCount : 1,
                suggestedCommit: {
                  type: g.commitType || "fix",
                  scope: g.commitScope || undefined,
                  subject: (g.commitSubject || "apply updates").slice(0, 72),
                  body: g.commitBody || undefined,
                  breakingChange: false,
                },
              });
            }
          }

          // If there are unassigned files, allocate them to the first group or create a fallback group
          const unassigned = changedFiles.filter((f) => !assignedFiles.has(f.filePath));
          const firstGroup = validGroups[0];
          if (unassigned.length > 0 && firstGroup) {
            for (const uf of unassigned) {
              firstGroup.files.push(uf.filePath);
              assignedFiles.add(uf.filePath);
            }
          }

          // Ensure all files were accounted for and we have at least 1 group
          if (validGroups.length > 0 && assignedFiles.size === changedFiles.length) {
            // Attach logical group name back to each changed file detail
            for (const group of validGroups) {
              for (const f of group.files) {
                const matched = changedFiles.find((cf) => cf.filePath === f);
                if (matched) {
                  matched.logicalGroup = group.name;
                  matched.summary = group.suggestedCommit.subject;
                }
              }
            }

            return {
              summary: parsed.summary || `${changedFiles.length} changed files grouped into ${validGroups.length} logical commits.`,
              totalFiles: changedFiles.length,
              totalCommits: validGroups.length,
              groups: validGroups,
              changedFiles,
            };
          }
        }
      }
    } catch {
      // Fall through to deterministic heuristic
    }
  }

  // Fallback: Heuristic grouping
  const heuristicGroups = groupFilesHeuristically(changedFiles);
  for (const group of heuristicGroups) {
    for (const f of group.files) {
      const matched = changedFiles.find((cf) => cf.filePath === f);
      if (matched) {
        matched.logicalGroup = group.name;
        matched.summary = group.suggestedCommit.subject;
      }
    }
  }

  return {
    summary: `${changedFiles.length} changed files organized into ${heuristicGroups.length} logical change groups.`,
    totalFiles: changedFiles.length,
    totalCommits: heuristicGroups.length,
    groups: heuristicGroups,
    changedFiles,
  };
}

/**
 * Execute commit plan sequentially:
 * Stages only the files in group 1, commits with verified SHA,
 * then stages files in group 2, commits with verified SHA, etc.
 * Never blindly executes `git add .`.
 */
export async function executeCommitPlan(
  repoPath: string,
  groups: LogicalChangeGroup[],
): Promise<CommitPlanExecutionResult> {
  const targetPath = getExecutionPath(repoPath);

  // 1. Verify working tree has changes
  const { stdout: initialStatus } = await safeExec("git status --porcelain", targetPath);
  if (!initialStatus.trim()) {
    return {
      success: false,
      commits: [],
      totalCreated: 0,
      branch: "unknown",
      message: "Nothing to commit — working tree is clean.",
    };
  }

  // 2. Get current branch
  let currentBranch = "main";
  try {
    const { stdout: branchOut } = await safeExec("git rev-parse --abbrev-ref HEAD", targetPath);
    currentBranch = branchOut.trim() || "main";
  } catch { }

  // 3. Unstage index to guarantee clean atomic group staging
  try {
    await safeExec("git reset HEAD", targetPath);
  } catch { }

  const executedCommits: ExecutedCommitResult[] = [];

  for (const group of groups) {
    if (!group.files || group.files.length === 0) continue;

    // Stage only the exact files belonging to this group
    for (const file of group.files) {
      try {
        await safeExec(`git add "${file}"`, targetPath);
      } catch (err: any) {
        console.warn(`[ChangeAnalyzer] Failed to stage file ${file}:`, err.message);
      }
    }

    // Verify there is staged content
    const { stdout: stagedCheck } = await safeExec("git diff --cached --name-only", targetPath);
    if (!stagedCheck.trim()) {
      // Nothing staged for this group, continue
      continue;
    }

    // Format commit message
    const msg = formatCommitMessage(group.suggestedCommit);
    const escapedMsg = msg.replace(/"/g, '\\"').replace(/`/g, "\\`");

    try {
      const { stdout: commitOut } = await safeExec(`git commit -m "${escapedMsg}"`, targetPath);

      // Verify commit SHA
      let sha = "";
      const hashMatch = /\[(?:.+?\s+)?([a-f0-9]{7,40})\]/.exec(commitOut);
      if (hashMatch && hashMatch[1]) {
        sha = hashMatch[1];
      } else {
        const { stdout: revOut } = await safeExec("git rev-parse --short HEAD", targetPath);
        sha = revOut.trim();
      }

      executedCommits.push({
        groupId: group.id,
        groupName: group.name,
        commitHash: sha,
        commitMessage: group.suggestedCommit.subject,
        files: group.files,
      });
    } catch (err: any) {
      return {
        success: false,
        commits: executedCommits,
        totalCreated: executedCommits.length,
        branch: currentBranch,
        message: `Commit for group '${group.name}' failed.`,
        error: err.message,
      };
    }
  }

  return {
    success: true,
    commits: executedCommits,
    totalCreated: executedCommits.length,
    branch: currentBranch,
    message: `Successfully executed ${executedCommits.length} logical commits on branch '${currentBranch}'.`,
  };
}
