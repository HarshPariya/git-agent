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

const STATUS_MAP: Record<string, ChangedFileDetail["status"]> = {
  "?": "untracked",
  A: "added",
  D: "deleted",
  R: "renamed",
};

const RISK_PATTERNS: ReadonlyArray<{ pattern: RegExp; level: "high" | "medium" }> = [
  { pattern: /security|auth|key|pass|secret/i, level: "high" },
  { pattern: /config|route|schema|db|migration/i, level: "medium" },
];

const GROUP_RULES: ReadonlyArray<{
  match: (p: string) => boolean;
  key: string;
  name: string;
  type: ConventionalCommit["type"];
  scope: string;
  reason: string;
}> = [
  {
    match: (p) => p.startsWith("test") || p.includes(".test.") || p.includes(".spec."),
    key: "tests",
    name: "Automated Tests",
    type: "test",
    scope: "tests",
    reason: "Unit and integration test suites coverage",
  },
  {
    match: (p) => p.startsWith("doc") || p.endsWith(".md") || p.endsWith(".txt"),
    key: "docs",
    name: "Documentation",
    type: "docs",
    scope: "docs",
    reason: "Documentation, guide, and specifications updates",
  },
  {
    match: (p) => p.includes("auth") || p.includes("security") || p.includes("guardrail"),
    key: "security",
    name: "Authentication & Security",
    type: "fix",
    scope: "auth",
    reason: "Security, guardrail, or authentication controls",
  },
  {
    match: (p) => p.includes("git") || p.includes("branch") || p.includes("commit") || p.includes("push"),
    key: "git",
    name: "Git Operations",
    type: "feat",
    scope: "git",
    reason: "Git engine, conflict resolution, or repository management",
  },
  {
    match: (p) => p.includes("api") || p.includes("route") || p.includes("server") || p.includes("app.ts"),
    key: "api",
    name: "API & Routing",
    type: "feat",
    scope: "api",
    reason: "API endpoint routing and service interface updates",
  },
  {
    match: (p) => p.includes("public") || p.endsWith(".html") || p.endsWith(".css") || p.includes("ui"),
    key: "ui",
    name: "User Interface",
    type: "feat",
    scope: "ui",
    reason: "Frontend UI components, styling, and client views",
  },
];

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const map = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.trim().split("\n")) {
    if (!line) continue;
    const [addStr, delStr, file] = line.split(/\s+/);
    if (file)
      map.set(file.trim(), {
        additions: parseInt(addStr ?? "0", 10) || 0,
        deletions: parseInt(delStr ?? "0", 10) || 0,
      });
  }
  return map;
}

async function fetchNumstat(targetPath: string): Promise<Map<string, { additions: number; deletions: number }>> {
  for (const cmd of ["git diff --numstat HEAD", "git diff --numstat"]) {
    try {
      const { stdout } = await safeExec(cmd, targetPath);
      return parseNumstat(stdout);
    } catch {
      /* try next command */
    }
  }
  return new Map();
}

function classifyFileRisk(filePath: string): "low" | "medium" | "high" {
  return RISK_PATTERNS.find((r) => r.pattern.test(filePath))?.level ?? "low";
}

function classifyFileStatus(indexCode: string, workCode: string): ChangedFileDetail["status"] {
  return STATUS_MAP[workCode] ?? STATUS_MAP[indexCode] ?? "modified";
}

function assignLogicalGroups(files: ChangedFileDetail[]): Map<
  string,
  {
    name: string;
    files: string[];
    risk: "low" | "medium" | "high";
    type: ConventionalCommit["type"];
    scope: string;
    reason: string;
  }
> {
  const groups = new Map<
    string,
    {
      name: string;
      files: string[];
      risk: "low" | "medium" | "high";
      type: ConventionalCommit["type"];
      scope: string;
      reason: string;
    }
  >();

  for (const file of files) {
    const rule = GROUP_RULES.find((r) => r.match(file.filePath.toLowerCase()));
    const key = rule?.key ?? "core";
    const existing = groups.get(key);

    if (existing) {
      existing.files.push(file.filePath);
      if (file.risk === "high") existing.risk = "high";
      else if (file.risk === "medium" && existing.risk !== "high") existing.risk = "medium";
    } else {
      groups.set(key, {
        name: rule?.name ?? "Core Implementation",
        files: [file.filePath],
        risk: file.risk,
        type: rule?.type ?? "fix",
        scope: rule?.scope ?? "core",
        reason: rule?.reason ?? "Core application source updates",
      });
    }
  }
  return groups;
}

export async function getDetailedChangedFiles(repoPath: string): Promise<ChangedFileDetail[]> {
  const targetPath = getExecutionPath(repoPath);
  const { stdout: statusOut } = await safeExec("git status --porcelain -uall", targetPath);
  if (!statusOut.trim()) return [];

  const numstatMap = await fetchNumstat(targetPath);

  return statusOut
    .trim()
    .split("\n")
    .filter((line) => line && line.length >= 3)
    .map((line) => {
      const indexCode = line.charAt(0);
      const workCode = line.charAt(1);
      const rawPath = line.slice(2).trim().replace(/^"|"$/g, "");
      const status = classifyFileStatus(indexCode, workCode);
      const isStaged = indexCode !== " " && indexCode !== "?";
      const stats = numstatMap.get(rawPath) ?? {
        additions: status === "added" || status === "untracked" ? 1 : 0,
        deletions: 0,
      };

      return {
        filePath: rawPath,
        status,
        staged: isStaged,
        additions: stats.additions,
        deletions: stats.deletions,
        risk: classifyFileRisk(rawPath),
      };
    });
}

function groupFilesHeuristically(files: ChangedFileDetail[]): LogicalChangeGroup[] {
  const groupsMap = assignLogicalGroups(files);
  let index = 0;

  return [...groupsMap.entries()].map(([, val]) => {
    index++;
    const isTest = val.type === "test";
    return {
      id: `group-${index}`,
      name: val.name,
      reason: val.reason,
      risk: val.risk,
      files: val.files,
      testCount: isTest ? val.files.length : Math.max(1, Math.floor(val.files.length * 1.5)),
      suggestedCommit: {
        type: val.type,
        scope: val.scope,
        subject: `update ${val.scope} components (${val.files.length} file${val.files.length > 1 ? "s" : ""})`,
        body: `Covers changes across:\n${val.files.map((f) => `- ${f}`).join("\n")}`,
        breakingChange: false,
      },
    };
  });
}

function annotateFiles(files: ChangedFileDetail[], groups: LogicalChangeGroup[]): void {
  for (const group of groups) {
    for (const filePath of group.files) {
      const file = files.find((f) => f.filePath === filePath);
      if (file) {
        file.logicalGroup = group.name;
        file.summary = group.suggestedCommit.subject;
      }
    }
  }
}

export async function analyzeAndPlanCommits(repoPath: string): Promise<CommitPlan> {
  const targetPath = getExecutionPath(repoPath);
  const changedFiles = await getDetailedChangedFiles(targetPath);
  if (!changedFiles.length)
    return {
      summary: "Working tree is clean. No changed files to analyze.",
      totalFiles: 0,
      totalCommits: 0,
      groups: [],
      changedFiles: [],
    };

  if (isLlmAvailable()) {
    try {
      const result = await planWithLlm(changedFiles);
      if (result) {
        annotateFiles(changedFiles, result.groups);
        return {
          summary: result.summary,
          totalFiles: changedFiles.length,
          totalCommits: result.groups.length,
          groups: result.groups,
          changedFiles,
        };
      }
    } catch {
      // Fall through to heuristic planning
    }
  }

  const heuristicGroups = groupFilesHeuristically(changedFiles);
  annotateFiles(changedFiles, heuristicGroups);
  return {
    summary: `${changedFiles.length} changed files organized into ${heuristicGroups.length} logical change groups.`,
    totalFiles: changedFiles.length,
    totalCommits: heuristicGroups.length,
    groups: heuristicGroups,
    changedFiles,
  };
}

interface LlmGroup {
  id?: string;
  name?: string;
  reason?: string;
  risk?: string;
  files?: string[];
  commitType?: string;
  commitScope?: string;
  commitSubject?: string;
  commitBody?: string;
  testCount?: number;
}

interface LlmResponse {
  summary?: string;
  groups: LlmGroup[];
}

async function planWithLlm(
  changedFiles: ChangedFileDetail[],
): Promise<{ summary: string; groups: LogicalChangeGroup[] } | null> {
  const fileListSummary = changedFiles
    .map((f) => `- ${f.filePath} (${f.status}, +${f.additions}/-${f.deletions}, risk: ${f.risk})`)
    .join("\n");
  const response = await callLlm([
    { role: "system", content: "You are an expert Git automation engine. Output valid JSON only." },
    {
      role: "user",
      content: `You are a Senior Staff Git Architect.\nAnalyze these ${changedFiles.length} changed files:\n${fileListSummary}\n\nGroup into 1-4 logical change groups. Rules:\n1. Every file MUST appear in exactly one group.\n2. Use EXACT file paths.\n3. Valid Conventional Commit types only.\n\nRespond ONLY with JSON:\n{"summary":"...","groups":[{"id":"group-1","name":"...","reason":"...","risk":"low"|"medium"|"high","files":["..."],"commitType":"feat"|"fix"|"docs"|"test"|"refactor"|"chore","commitScope":"...","commitSubject":"...","commitBody":"...","testCount":2}]}`,
    },
  ]);

  const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]) as LlmResponse;
  if (!Array.isArray(parsed.groups) || !parsed.groups.length) return null;

  const validPathSet = new Set(changedFiles.map((f) => f.filePath));
  const assignedFiles = new Set<string>();
  const validGroups: LogicalChangeGroup[] = [];

  for (let idx = 0; idx < parsed.groups.length; idx++) {
    const g = parsed.groups[idx]!;
    if (!Array.isArray(g.files)) continue;

    const groupFiles = g.files.filter((fp: string) => {
      if (!validPathSet.has(fp) || assignedFiles.has(fp)) return false;
      assignedFiles.add(fp);
      return true;
    });

    if (groupFiles.length) {
      validGroups.push({
        id: g.id ?? `group-${idx + 1}`,
        name: g.name ?? `Logical Change ${idx + 1}`,
        reason: g.reason ?? "Semantically cohesive file changes",
        risk: g.risk === "high" || g.risk === "medium" ? g.risk : "low",
        files: groupFiles,
        testCount: typeof g.testCount === "number" ? g.testCount : 1,
        suggestedCommit: {
          type: (g.commitType ?? "fix") as ConventionalCommit["type"],
          scope: g.commitScope ?? "",
          subject: (g.commitSubject ?? "apply updates").slice(0, 72),
          body: g.commitBody ?? "",
          breakingChange: false,
        },
      });
    }
  }

  if (!validGroups.length || assignedFiles.size !== changedFiles.length) return null;

  const unassigned = changedFiles.filter((f) => !assignedFiles.has(f.filePath));
  if (unassigned.length) validGroups[0]?.files.push(...unassigned.map((f) => f.filePath));

  return {
    summary:
      parsed.summary ?? `${changedFiles.length} changed files grouped into ${validGroups.length} logical commits.`,
    groups: validGroups,
  };
}

export async function executeCommitPlan(
  repoPath: string,
  groups: LogicalChangeGroup[],
): Promise<CommitPlanExecutionResult> {
  const targetPath = getExecutionPath(repoPath);
  const { stdout: initialStatus } = await safeExec("git status --porcelain", targetPath);
  if (!initialStatus.trim())
    return {
      success: false,
      commits: [],
      totalCreated: 0,
      branch: "unknown",
      message: "Nothing to commit — working tree is clean.",
    };

  const currentBranch = await resolveCurrentBranch(targetPath);
  await safeExec("git reset HEAD", targetPath).catch(() => {});

  const executedCommits: ExecutedCommitResult[] = [];

  for (const group of groups) {
    if (!group.files?.length) continue;

    for (const file of group.files) {
      try {
        await safeExec(`git add "${file}"`, targetPath);
      } catch (err: unknown) {
        console.warn(
          `[ChangeAnalyzer] Failed to stage file ${file}:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const { stdout: stagedCheck } = await safeExec("git diff --cached --name-only", targetPath);
    if (!stagedCheck.trim()) continue;

    const msg = formatCommitMessage(group.suggestedCommit);
    const escapedMsg = msg.replace(/"/g, '\\"').replace(/`/g, "\\`");
    try {
      const { stdout: commitOut } = await safeExec(`git commit -m "${escapedMsg}"`, targetPath);
      const sha = /\[(?:.+?\s+)?([a-f0-9]{7,40})\]/.exec(commitOut)?.[1] ?? (await resolveHeadSha(targetPath));
      executedCommits.push({
        groupId: group.id,
        groupName: group.name,
        commitHash: sha,
        commitMessage: group.suggestedCommit.subject,
        files: group.files,
      });
    } catch (err: unknown) {
      return {
        success: false,
        commits: executedCommits,
        totalCreated: executedCommits.length,
        branch: currentBranch,
        message: `Commit for group '${group.name}' failed.`,
        error: err instanceof Error ? err.message : String(err),
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

async function resolveCurrentBranch(targetPath: string): Promise<string> {
  try {
    const { stdout } = await safeExec("git rev-parse --abbrev-ref HEAD", targetPath);
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}

async function resolveHeadSha(targetPath: string): Promise<string> {
  try {
    const { stdout } = await safeExec("git rev-parse --short HEAD", targetPath);
    return stdout.trim();
  } catch {
    return "";
  }
}
