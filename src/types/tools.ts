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
