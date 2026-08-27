import type { RetrievalResult } from "../retrieval/types.js";

export interface AgentContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly question: string;
}

export interface AgentExecutionResult {
  readonly text: string;
  readonly model: string;
  readonly responseId: string;
  readonly sources: readonly RetrievalResult[];
}