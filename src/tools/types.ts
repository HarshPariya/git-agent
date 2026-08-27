export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolRequest<TInput = unknown> {
  readonly input: TInput;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly parseInput: (input: unknown) => TInput;
  readonly execute: (request: ToolRequest<TInput>) => Promise<TOutput>;
}

export interface RuntimeTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly execute: (input: unknown) => Promise<unknown>;
}
