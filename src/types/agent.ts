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

export type AgentAction = "direct_answer" | "retrieve" | "tool";

export interface PlanRequest {
  readonly question: string;
  readonly hasConversationContext: boolean;
}

export interface AgentPlan {
  readonly action: AgentAction;
  readonly reason: string;
}

export interface CriticRequest {
  readonly question: string;
  readonly answer: string;
  readonly context: string;
}

export interface CriticResult {
  readonly passed: boolean;
  readonly reason: string;
}

export interface QueryRewriteRequest {
  readonly question: string;
  readonly conversationContext?: string;
}

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface Memory {
  get(tenantId: string, sessionId: string): readonly Message[];
  add(tenantId: string, sessionId: string, message: Message): void;
  clear(tenantId: string, sessionId: string): void;
}
