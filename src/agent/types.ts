import type { RetrievalResult } from "../retrieval/types.js";

export interface AgentContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly documentIds?: readonly string[] | undefined;
  readonly retrievalMode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
}

export interface AgentExecutionResult {
  readonly text: string;
  readonly model: string;
  readonly responseId: string;
  readonly sources: readonly RetrievalResult[];
}
