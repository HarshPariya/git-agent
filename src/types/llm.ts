import type Groq from "groq-sdk";

export interface LlmRequest {
  readonly instructions: string;
  readonly input: string;
}

export interface LlmResponse {
  readonly id: string;
  readonly model: string;
  readonly text: string;
}

export interface LlmProvider {
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolLlmResponse extends LlmResponse {
  readonly toolCalls: readonly ToolCall[];
  readonly message: Groq.Chat.Completions.ChatCompletionMessage;
}

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface LlmCostConfig {
  readonly maxTokensPerRequest: number;
  readonly maxTokensPerMinute: number;
  readonly enableCaching: boolean;
  readonly cacheTtlMs: number;
  readonly summarizeLongContext: boolean;
  readonly maxContextLength: number;
  readonly costPer1kTokens?: number;
}

export interface CostMetrics {
  readonly totalTokens: number;
  readonly totalRequests: number;
  readonly totalCostUsd: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly avgTokensPerRequest: number;
}
