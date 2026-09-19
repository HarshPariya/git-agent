export type RepositoryMode = "LOCAL" | "REMOTE";

export type FileClassification =
  "SOURCE" | "TEST" | "CONFIG" | "DOC" | "CI" | "GENERATED" | "DEPENDENCY" | "BINARY" | "SECRET" | "UNKNOWN";

export interface RepositoryFileEntry {
  readonly path: string;
  readonly type: FileClassification;
  readonly size?: number | undefined;
  readonly language?: string | undefined;
  readonly lastModified?: string | undefined;
}

export interface RepositoryGitSnapshot {
  readonly branch: string;
  readonly clean: boolean;
  readonly ahead?: number | undefined;
  readonly behind?: number | undefined;
  readonly changedFiles: readonly string[];
  readonly diff?: string | undefined;
  readonly recentCommits?: string | undefined;
  readonly branches?: readonly string[] | undefined;
}

export interface RepositoryManifest {
  readonly totalFiles: number;
  readonly sourceFiles: number;
  readonly testFiles: number;
  readonly configFiles: number;
  readonly docFiles: number;
  readonly ciFiles: number;
  readonly ignoredFiles: number;
  readonly detectedLanguages: readonly string[];
  readonly packageManager?: string | undefined;
  readonly framework?: string | undefined;
}

export interface RepositoryContext {
  readonly repositoryId: string;
  readonly workspaceId: string;
  readonly mode: RepositoryMode;
  readonly displayName: string;
  readonly rootIdentifier: string;
  readonly branch: string;
  readonly remoteUrl?: string | undefined;
  readonly source?: string | undefined;
  readonly localPath?: string | undefined;
  readonly fileManifest?: readonly RepositoryFileEntry[] | undefined;
  readonly fileContents?: Record<string, string> | undefined;
  readonly manifestSummary?: RepositoryManifest | undefined;
  readonly gitSnapshot?: RepositoryGitSnapshot | undefined;
  readonly indexedAt?: string | undefined;
}

export const REPOSITORY_REQUIRED = "REPOSITORY_REQUIRED";
