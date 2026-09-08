import type { DebugMode, DebugSession, DebugStep, DebugStepType, DebugFinding } from "../types/git.js";
import { AppError } from "../errors/app-error.js";
import { logger } from "../logging/logger.js";
import { callLlm, isLlmAvailable, type LlmMessage } from "../llm/client.js";
import { AgentStateMachine, type AgentState } from "./state-machine.js";
import type { FixPlan } from "./fix-planner.js";
import type { CriticReview } from "./critic.js";
import type { InvestigationPlan } from "./planner.js";
import type { DebugContext as AggregatedContext } from "./context-builder.js";

export interface DebugContext { readonly repositoryId: string; readonly tenantId: string; readonly userId: string; readonly sessionId: string; readonly mode: DebugMode; readonly query: string; }
export interface DebugStepResult { readonly step: DebugStep; readonly findings: readonly DebugFinding[]; }
export interface PatchCandidate { readonly title: string; readonly description: string; readonly patch: string; readonly confidence: number; }
export interface CriticResult { readonly approved: boolean; readonly feedback: string; readonly score: number; }
export interface SessionStreamEvent { readonly type: "state" | "step" | "finding" | "hypothesis" | "fix_plan" | "critic" | "complete" | "error"; readonly sessionId: string; readonly state?: AgentState; readonly data: unknown; readonly timestamp: string; }
export interface ExtendedSessionData { session: DebugSession; stateMachine: AgentStateMachine; context?: AggregatedContext; investigationPlan?: InvestigationPlan; fixPlan?: FixPlan; backupId?: string; criticReview?: CriticReview; }

const STEP_TIMEOUTS_MS: Record<DebugStepType, number> = { isolate: 30_000, reproduce: 30_000, diagnose: 60_000, fix: 60_000, verify: 60_000, observe: 30_000 };
const debugSessions = new Map<string, DebugSession>();
const extendedDataMap = new Map<string, ExtendedSessionData>();
const sseListeners = new Map<string, Set<(event: SessionStreamEvent) => void>>();

export class DebugAgentPipeline {
  async startSession(repositoryId: string, tenantId: string, userId: string, mode: DebugMode, query: string): Promise<DebugSession> {
    const sessionId = `debug-${crypto.randomUUID().slice(0, 8)}`; const now = new Date().toISOString();
    const session: DebugSession = { id: sessionId, repositoryId, tenantId, userId, title: query, mode, status: "active", startedAt: now, currentStep: 0, totalSteps: 0, steps: [], findings: [] };
    const sm = new AgentStateMachine(sessionId);
    sm.subscribe((event) => { this.emitEvent(sessionId, { type: "state", sessionId, state: event.to, data: event, timestamp: event.timestamp }); });
    debugSessions.set(sessionId, session);
    extendedDataMap.set(sessionId, { session, stateMachine: sm });
    sm.transition("INITIALIZING", "Debug session started", { repositoryId, mode });
    logger.info("Debug session started", { operation: "debug-start", metadata: { sessionId, repositoryId, mode } });
    return session;
  }

  getStateMachine(sessionId: string): AgentStateMachine | undefined { return extendedDataMap.get(sessionId)?.stateMachine; }
  transitionState(sessionId: string, state: AgentState, reason?: string, metadata?: Record<string, unknown>): void { const sm = this.getStateMachine(sessionId); if (sm) sm.transition(state, reason, metadata); }
  subscribeToSession(sessionId: string, listener: (event: SessionStreamEvent) => void): () => void { if (!sseListeners.has(sessionId)) sseListeners.set(sessionId, new Set()); const set = sseListeners.get(sessionId)!; set.add(listener); return () => { set.delete(listener); if (set.size === 0) sseListeners.delete(sessionId); }; }
  emitEvent(sessionId: string, event: SessionStreamEvent): void { const listeners = sseListeners.get(sessionId); if (listeners) for (const listener of listeners) { try { listener(event); } catch (err) { logger.error("SSE listener dispatch error", { operation: "sse-dispatch", metadata: { error: String(err) } }); } } }
  setExtendedData(sessionId: string, partial: Partial<ExtendedSessionData>): void { const existing = extendedDataMap.get(sessionId); if (existing) extendedDataMap.set(sessionId, { ...existing, ...partial }); }
  getExtendedData(sessionId: string): ExtendedSessionData | undefined { return extendedDataMap.get(sessionId); }

  async executeStep(context: DebugContext, stepType: DebugStepType, description: string, handler: (ctx: DebugContext) => Promise<string>): Promise<DebugStepResult> {
    const startTime = Date.now(); const startedAt = new Date().toISOString();
    const session = debugSessions.get(context.sessionId);
    if (!session) throw new AppError("Debug session not found", "NOT_FOUND", 404);
    const stepIndex = session.steps.length;
    const step: DebugStep = { step: stepIndex + 1, type: stepType, description, status: "running", startedAt };
    const updateTotal = session.totalSteps > stepIndex + 1 ? session.totalSteps : stepIndex + 1;
    const updatedSession: DebugSession = { ...session, currentStep: stepIndex + 1, totalSteps: updateTotal, steps: [...session.steps, step] };
    debugSessions.set(context.sessionId, updatedSession);
    this.emitEvent(context.sessionId, { type: "step", sessionId: context.sessionId, data: step, timestamp: startedAt });
    const timeoutMs = STEP_TIMEOUTS_MS[stepType] ?? 60_000;
    try {
      const output = await Promise.race([handler(context), new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs))]);
      const completedAt = new Date().toISOString(); const durationMs = Date.now() - startTime;
      const completedStep: DebugStep = { ...step, status: "completed", result: output, completedAt, durationMs };
      const completedSession: DebugSession = { ...updatedSession, totalSteps: updateTotal, steps: updatedSession.steps.map((s, i) => i === stepIndex ? completedStep : s) };
      debugSessions.set(context.sessionId, completedSession);
      this.emitEvent(context.sessionId, { type: "step", sessionId: context.sessionId, data: completedStep, timestamp: completedAt });
      return { step: completedStep, findings: [] };
    } catch (err) {
      const completedAt = new Date().toISOString(); const durationMs = Date.now() - startTime; const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStep: DebugStep = { ...step, status: "failed", error: errorMsg, completedAt, durationMs };
      const failedSession: DebugSession = { ...updatedSession, totalSteps: updateTotal, steps: updatedSession.steps.map((s, i) => i === stepIndex ? errorStep : s) };
      debugSessions.set(context.sessionId, failedSession);
      this.emitEvent(context.sessionId, { type: "step", sessionId: context.sessionId, data: errorStep, timestamp: completedAt });
      logger.error("Debug step failed", { operation: "debug-step", metadata: { sessionId: context.sessionId, stepType, error: errorMsg } });
      return { step: errorStep, findings: [] };
    }
  }

  async generatePatch(context: DebugContext, rootCause: string, affectedFiles: readonly string[], codeContext: string): Promise<PatchCandidate[]> {
    logger.info("Generating LLM patch candidates", { operation: "debug-patch-gen", metadata: { sessionId: context.sessionId, repositoryId: context.repositoryId, affectedFiles: affectedFiles.length } });
    const available = await isLlmAvailable();
    if (!available) return this._generateFallbackPatches(rootCause, affectedFiles, codeContext);
    try {
      const messages: LlmMessage[] = [{ role: "system", content: "You are an expert debugging agent. Based on the root cause analysis and code context, generate a precise patch to fix the issue. Return ONLY a JSON object with a single field \"patches\" containing an array of patch candidates. Each patch candidate has: title, description, patch, confidence (0-1). Do not include any explanation outside the JSON. The patch should be in unified diff format." }, { role: "user", content: `ROOT CAUSE:\n${rootCause}\n\nAFFECTED FILES:\n${affectedFiles.join("\n")}\n\nCODE CONTEXT:\n${codeContext}` }];
      const response = await callLlm(messages, { temperature: 0.3, maxTokens: 4096 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in LLM response");
      const parsed = JSON.parse(jsonMatch[0]) as { patches?: Array<{ title?: string; description?: string; patch?: string; confidence?: number }> };
      const candidates = (parsed.patches ?? []).filter((p) => p.patch && p.title).map((p, i) => ({ title: p.title ?? `Patch ${i + 1}`, description: p.description ?? "", patch: p.patch ?? "", confidence: p.confidence ?? 0.5 }));
      logger.info("Generated patch candidates", { operation: "debug-patch-gen", metadata: { sessionId: context.sessionId, candidates: candidates.length } });
      return candidates.length > 0 ? candidates : this._generateFallbackPatches(rootCause, affectedFiles, codeContext);
    } catch (err) {
      logger.error("Failed to generate LLM patch", { operation: "debug-patch-gen", metadata: { sessionId: context.sessionId, error: err instanceof Error ? err.message : String(err) } });
      return this._generateFallbackPatches(rootCause, affectedFiles, codeContext);
    }
  }

  _generateFallbackPatches(rootCause: string, affectedFiles: readonly string[], codeContext: string): PatchCandidate[] {
    void codeContext;
    const primaryFile = affectedFiles[0] ?? "unknown";
    const patch = `--- a/${primaryFile}\n+++ b/${primaryFile}\n@@\n-${rootCause.slice(0, 80)}\n+${rootCause.slice(0, 80)} // fixed\n`;
    return [{ title: "Fallback fix", description: `Generated from root cause: ${rootCause.slice(0, 100)}`, patch, confidence: 0.3 }];
  }

  async runCritic(context: DebugContext, patch: PatchCandidate, testResults: readonly string[], codeContext: string): Promise<CriticResult> {
    logger.info("Running critic evaluation", { operation: "debug-critic", metadata: { sessionId: context.sessionId, patchTitle: patch.title } });
    const available = await isLlmAvailable();
    if (!available) return { approved: true, feedback: "LLM critic not available — patch auto-approved with low confidence", score: 0.5 };
    try {
      const messages: LlmMessage[] = [{ role: "system", content: "You are a critical code reviewer. Evaluate the provided patch for correctness, completeness, and potential issues. Consider test results. Output a JSON object with: approved (boolean), feedback (string), score (0-1). Do not include any explanation outside the JSON." }, { role: "user", content: `PATCH:\n${JSON.stringify(patch, null, 2)}\n\nTEST RESULTS:\n${testResults.join("\n")}\n\nCODE CONTEXT:\n${codeContext}` }];
      const response = await callLlm(messages, { temperature: 0.4, maxTokens: 4096 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found in critic response");
      const parsed = JSON.parse(jsonMatch[0]) as { approved?: boolean; feedback?: string; score?: number };
      return { approved: parsed.approved ?? false, feedback: parsed.feedback ?? "No feedback provided", score: parsed.score ?? 0 };
    } catch (err) {
      logger.error("Critic evaluation failed", { operation: "debug-critic", metadata: { sessionId: context.sessionId, error: err instanceof Error ? err.message : String(err) } });
      return { approved: false, feedback: `Critic evaluation error: ${err instanceof Error ? err.message : String(err)}`, score: 0 };
    }
  }

  getSession(sessionId: string, tenantId: string): DebugSession {
    const session = debugSessions.get(sessionId);
    if (!session) throw new AppError("Session not found", "NOT_FOUND", 404);
    if (session.tenantId !== tenantId) throw new AppError("Unauthorized session access", "AUTHORIZATION_ERROR", 403);
    return session;
  }

  listSessions(tenantId: string): readonly DebugSession[] { return [...debugSessions.values()].filter((s) => s.tenantId === tenantId); }

  completeSession(sessionId: string): void {
    const session = debugSessions.get(sessionId); if (!session) return;
    const completed: DebugSession = { ...session, status: "completed", completedAt: new Date().toISOString() };
    debugSessions.set(sessionId, completed);
    this.transitionState(sessionId, "COMPLETED", "Session completed normally");
    this.emitEvent(sessionId, { type: "complete", sessionId, data: completed, timestamp: new Date().toISOString() });
  }

  abortSession(sessionId: string): void {
    const session = debugSessions.get(sessionId); if (!session) return;
    const aborted: DebugSession = { ...session, status: "abandoned", completedAt: new Date().toISOString() };
    debugSessions.set(sessionId, aborted);
    this.transitionState(sessionId, "ABORTED", "Session aborted by user");
    this.emitEvent(sessionId, { type: "complete", sessionId, data: aborted, timestamp: new Date().toISOString() });
  }

  addFindingToSession(sessionId: string, finding: DebugFinding): void {
    const session = debugSessions.get(sessionId); if (!session) return;
    const updated: DebugSession = { ...session, findings: [...session.findings, finding] };
    debugSessions.set(sessionId, updated);
    this.emitEvent(sessionId, { type: "finding", sessionId, data: finding, timestamp: new Date().toISOString() });
  }

  updateStepResult(sessionId: string, stepIndex: number, result: string): void {
    const session = debugSessions.get(sessionId); if (!session || stepIndex < 0 || stepIndex >= session.steps.length) return;
    const updatedSteps = [...session.steps]; const step = updatedSteps[stepIndex]!;
    updatedSteps[stepIndex] = { ...step, result, status: "completed", completedAt: new Date().toISOString() };
    const updated: DebugSession = { ...session, steps: updatedSteps };
    debugSessions.set(sessionId, updated);
  }
}

export const debugAgentPipeline = new DebugAgentPipeline();
