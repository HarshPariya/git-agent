export type GitOperationType =
  | "status"
  | "log"
  | "diff"
  | "branch"
  | "checkout"
  | "commit"
  | "push"
  | "pull"
  | "merge"
  | "reset"
  | "revert"
  | "tag"
  | "stash"
  | "cherry-pick"
  | "amend"
  | "fetch"
  | "clone"
  | "init";
export type GitOperationRisk = "safe" | "controlled" | "dangerous";

export interface GitOperation {
  readonly type: GitOperationType;
  readonly risk: GitOperationRisk;
  readonly command: string;
  readonly description: string;
  readonly requiresApproval: boolean;
  readonly dryRunSupported: boolean;
}

export interface GitStatusEntry {
  readonly filePath: string;
  readonly status: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored";
  readonly staged: boolean;
  readonly workingTreeStatus: string;
  readonly indexStatus: string;
}

export interface GitStatusOutput {
  readonly branch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly detached: boolean;
  readonly entries: readonly GitStatusEntry[];
  readonly clean: boolean;
}

export interface GitLogEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly author: string;
  readonly email: string;
  readonly date: string;
  readonly message: string;
  readonly branch: string;
}

export interface GitDiffEntry {
  readonly filePath: string;
  readonly oldFile?: string;
  readonly newFile?: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
}

export interface GitBranch {
  readonly name: string;
  readonly current: boolean;
  readonly ahead: number;
  readonly behind: number;
  readonly remote?: string;
}

export interface ProtectedBranch {
  readonly id: string;
  readonly name: string;
  readonly repositoryId: string;
  readonly allowedPushRoles: readonly string[];
  readonly requiresReview: boolean;
  readonly requiredApprovals: number;
  readonly requiresStatusChecks: boolean;
  readonly requiresLinearHistory: boolean;
  readonly allowsForcePush: boolean;
  readonly allowsDeletion: boolean;
}

export interface Repository {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly url: string | undefined;
  readonly localPath: string;
  readonly defaultBranch: string;
  readonly currentBranch: string;
  readonly status: "connected" | "syncing" | "disconnected" | "error";
  readonly lastSyncAt?: string;
  readonly createdAt: string;
  readonly protectedBranches: readonly ProtectedBranch[];
}

export type DebugMode =
  "debug" | "issues" | "prs" | "ci" | "conflicts" | "history" | "changes" | "graphrag" | "agent-runs" | "settings";

export interface DebugSession {
  readonly id: string;
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly title: string;
  readonly mode: DebugMode;
  readonly status: "active" | "paused" | "completed" | "abandoned";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly steps: readonly DebugStep[];
  readonly findings: readonly DebugFinding[];
}

export interface DebugStep {
  readonly step: number;
  readonly type: DebugStepType;
  readonly description: string;
  readonly status: "pending" | "running" | "completed" | "failed" | "skipped";
  readonly result?: string;
  readonly error?: string;
  readonly durationMs?: number;
  readonly startedAt: string;
  readonly completedAt?: string;
}

export type DebugStepType = "isolate" | "reproduce" | "diagnose" | "fix" | "verify" | "observe";

export interface DebugFinding {
  readonly id: string;
  readonly step: number;
  readonly type: DebugFindingType;
  readonly title: string;
  readonly description: string;
  readonly evidence: readonly string[];
  readonly confidence: number;
  readonly rootCause?: string;
  readonly suggestedFix?: string;
}

export type DebugFindingType =
  "bug" | "regression" | "performance" | "security" | "compatibility" | "configuration" | "test_failure";

export interface CiBuild {
  readonly id: string;
  readonly repositoryId: string;
  readonly branch: string;
  readonly commitHash: string;
  readonly status: "queued" | "running" | "passed" | "failed" | "cancelled";
  readonly triggeredBy: string;
  readonly triggerType: "push" | "pull_request" | "manual" | "schedule";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly steps: readonly CiBuildStep[];
  readonly logsUrl?: string;
}

export interface CiBuildStep {
  readonly name: string;
  readonly status: "queued" | "running" | "passed" | "failed" | "skipped";
  readonly durationMs?: number;
  readonly output?: string;
}

export interface PullRequest {
  readonly id: string;
  readonly repositoryId: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly status: "open" | "closed" | "merged" | "draft";
  readonly sourceBranch: string;
  readonly targetBranch: string;
  readonly author: string;
  readonly reviewer?: string;
  readonly reviewers: readonly PullRequestReviewer[];
  readonly baseSha: string;
  readonly headSha: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt?: string;
  readonly mergeConflict?: MergeConflict;
  readonly labels: readonly string[];
}

export interface PullRequestReviewer {
  readonly user: string;
  readonly status: "pending" | "approved" | "changes_requested" | "commented";
  readonly reviewedAt?: string;
  readonly comment?: string;
}

export interface MergeConflict {
  readonly files: readonly MergeConflictFile[];
  readonly baseSha: string;
  readonly sourceSha: string;
  readonly targetSha: string;
}

export interface MergeConflictFile {
  readonly path: string;
  readonly autoMerge: boolean;
  readonly conflictMarkers: readonly ConflictMarker[];
  readonly resolution?: string;
}

export interface ConflictMarker {
  readonly line: number;
  readonly type: "current" | "incoming" | "base";
  readonly content: string;
}

export interface AuditEntry {
  readonly id: string;
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly action: string;
  readonly category: AuditCategory;
  readonly details: string;
  readonly riskLevel: "low" | "medium" | "high" | "critical";
  readonly timestamp: string;
  readonly metadata?: Record<string, unknown>;
}

export type AuditCategory =
  | "git_operation"
  | "branch_protection"
  | "merge"
  | "push"
  | "pull"
  | "debug_session"
  | "ci_build"
  | "pull_request"
  | "security"
  | "rollback";

export interface CodeSymbol {
  readonly id: string;
  readonly repositoryId: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: CodeSymbolKind;
  readonly startLine: number;
  readonly endLine: number;
  readonly signature?: string;
  readonly language: string;
  readonly containerName?: string;
}

export type CodeSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "method"
  | "property"
  | "variable"
  | "constant"
  | "type"
  | "enum"
  | "module"
  | "import"
  | "export";

export interface CodeGraphNode {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  readonly kind: CodeSymbolKind;
  readonly startLine: number;
  readonly endLine: number;
}

export interface CodeGraphEdge {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationship: "calls" | "imports" | "extends" | "implements" | "references" | "contains";
}

export interface RepositoryIndexStatus {
  readonly repositoryId: string;
  readonly status: "indexing" | "indexed" | "failed" | "never";
  readonly lastIndexedAt?: string;
  readonly totalFiles: number;
  readonly totalSymbols: number;
  readonly totalChunks: number;
  readonly progress: number;
}

export interface SyncResult {
  readonly repositoryId: string;
  readonly status: "success" | "conflict" | "error";
  readonly ahead: number;
  readonly behind: number;
  readonly mergedBranches: readonly string[];
  readonly conflicts: readonly MergeConflictFile[];
}
