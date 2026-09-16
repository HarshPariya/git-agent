export interface LocalAgentConfig {
  host: string;
  port: number;
  allowedOrigins: string[];
  tokenExpiryHours: number;
  tokenFilePath: string;
}

export interface HealthResponse {
  status: "ok";
  version: string;
  gitInstalled: boolean;
  gitVersion?: string;
  platform: string;
  nodeVersion: string;
  timestamp: string;
}

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGit: boolean;
}

export interface BrowseResponse {
  currentPath: string;
  parentPath: string | null;
  entries: BrowseEntry[];
}

export interface ValidateRepoResponse {
  isGit: boolean;
  path: string;
  name: string;
  branch: string;
  remoteUrl: string;
}

export interface LocalGitStatusEntry {
  filePath: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  staged: boolean;
  workingTreeStatus: string;
  indexStatus: string;
}

export interface LocalGitStatus {
  branch: string;
  clean: boolean;
  ahead: number;
  behind: number;
  entries: LocalGitStatusEntry[];
  raw?: string;
}

export interface LocalGitBranch {
  name: string;
  current: boolean;
  remote?: string;
}

export interface LocalGitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  authorDate: string;
  relativeDate: string;
}

export interface TestRunResult {
  command: string;
  success: boolean;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface PatchChange {
  filePath: string;
  content: string;
}

export interface PatchApplyResult {
  success: boolean;
  backupId: string;
  modifiedFiles: string[];
  error?: string;
}

export interface PatchRevertResult {
  success: boolean;
  restoredFiles: string[];
  error?: string;
}
