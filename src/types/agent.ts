import type { RetrievalResult } from "../retrieval/types.js";

export interface ActiveFileContext {
  readonly path: string;
  readonly name: string;
  readonly content?: string | undefined;
  readonly selectedText?: string | undefined;
}

export interface AgentContext {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly question: string;
  readonly documentIds?: readonly string[] | undefined;
  readonly retrievalMode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
  /** Absolute path to the user's local workspace. Falls back to process.cwd() if not provided. */
  readonly workspaceRoot?: string | undefined;
  /** ID of the active workspace */
  readonly workspaceId?: string | undefined;
  /** Currently active file open in the IDE editor */
  readonly activeFile?: ActiveFileContext | undefined;
  /** List of all file paths present in the user's opened workspace */
  readonly workspaceFiles?: readonly string[] | undefined;
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
  readonly modifiedFile?: { readonly path: string; readonly content: string } | undefined;
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
  readonly mode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
}

export interface Memory {
  get(tenantId: string, sessionId: string): readonly Message[];
  add(tenantId: string, sessionId: string, message: Message): void;
  clear(tenantId: string, sessionId: string): void;
}
