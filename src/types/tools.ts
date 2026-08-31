export type JsonSchema = Readonly<Record<string, unknown>>;

export type ToolPermission = "read" | "write" | "admin";

export interface ToolRequest<TInput = unknown> {
  readonly input: TInput;
  readonly permissions: readonly ToolPermission[];
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly permissions: readonly ToolPermission[];
  readonly timeoutMs: number;
  readonly parseInput: (input: unknown) => TInput;
  readonly execute: (request: ToolRequest<TInput>) => Promise<TOutput>;
}

export interface RuntimeTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly permissions: readonly ToolPermission[];
  readonly timeoutMs: number;
  readonly execute: (input: unknown) => Promise<unknown>;
}

export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly userPermissions: readonly ToolPermission[];
}

export interface ToolExecutionResult<TOutput = unknown> {
  readonly toolName: string;
  readonly callId: string;
  readonly success: boolean;
  readonly output: TOutput | undefined;
  readonly error: string | undefined;
  readonly durationMs: number;
}

export interface ListDirectoryInput {
  readonly path?: string;
  readonly recursive?: boolean;
  readonly maxEntries?: number;
}

export interface DirectoryEntry {
  readonly name: string;
  readonly type: "file" | "directory";
  readonly size?: number;
  readonly relativePath: string;
}

export interface ListDirectoryOutput {
  readonly path: string;
  readonly totalEntries: number;
  readonly entries: readonly DirectoryEntry[];
}

export interface ReadFileInput {
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
}

export interface ReadFileOutput {
  readonly path: string;
  readonly totalLines: number;
  readonly linesReturned: number;
  readonly content: string;
}

export interface GitStatusInput {
  readonly action?: "status" | "branch" | "log";
}

export interface GitStatusOutput {
  readonly action: string;
  readonly output: string;
}

export interface EditFileInput {
  readonly path: string;
  readonly targetContent: string;
  readonly replacementContent: string;
}

export interface EditFileOutput {
  readonly path: string;
  readonly modified: boolean;
  readonly message: string;
}

export interface WriteFileInput {
  readonly path: string;
  readonly content: string;
  readonly overwrite?: boolean;
}

export interface WriteFileOutput {
  readonly path: string;
  readonly bytesWritten: number;
  readonly message: string;
}

export interface DeleteFileInput {
  readonly path: string;
}

export interface DeleteFileOutput {
  readonly path: string;
  readonly deleted: boolean;
  readonly message: string;
}
