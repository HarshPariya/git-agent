import type { RetrievalResult } from "../retrieval/types.js";

export interface AgentContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly question: string;
}

/**
 * Records a single tool call that occurred during agent execution.
 * Exposed in AgentExecutionResult for frontend display of tool activity.
 *
 * Note: error uses `string | undefined` (not optional) so it always appears
 * in the shape and avoids exactOptionalPropertyTypes constraint issues.
 */
export interface ToolActivity {
  readonly toolName: string;
  readonly success: boolean;
  readonly durationMs: number;
  readonly error: string | undefined;
}

export interface AgentExecutionResult {
  readonly text: string;
  readonly model: string;
  readonly responseId: string;
  readonly sources: readonly RetrievalResult[];
  readonly toolActivity: readonly ToolActivity[];
}

/**
 * The five possible routing outcomes:
 * - direct_answer  : LLM answers from knowledge without retrieval or tools
 * - retrieve       : Fetch evidence from knowledge base, then generate grounded answer
 * - tool           : Execute one or more workspace/git tools autonomously
 * - clarify        : Insufficient information to act — ask user for clarification
 * - refuse         : Request is unsafe, destructive, or prohibited — politely refuse
 */
export type AgentAction =
  | "direct_answer"
  | "retrieve"
  | "tool"
  | "clarify"
  | "refuse";

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
