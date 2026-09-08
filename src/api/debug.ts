import type { NextFunction, Request, Response } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debugOrchestrator } from "../agent/debug-orchestrator.js";
import { debugAgentPipeline } from "../agent/debug-agent.js";
import { AppError } from "../errors/app-error.js";
import type { DebugMode } from "../types/git.js";
import { classifyTask, generateInvestigationPlan } from "../agent/planner.js";
import { fixPlanner } from "../agent/fix-planner.js";
import { applyPatch, revertPatch, applyDiffHunk, type PatchFileChange } from "../agent/patch-engine.js";
import { getExecutionPath } from "../git/engine.js";

const getCtx = (request: Request) => request.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
const getBody = (request: Request) => (typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {});
const requireRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : (() => { throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400); })();
const requireQuery = (body: Record<string, unknown>) => typeof body.query === "string" && body.query.trim() ? body.query.trim() : (() => { throw new AppError("query is required", "VALIDATION_ERROR", 400); })();
const optionalMode = (body: Record<string, unknown>) => typeof body.mode === "string" && body.mode.trim() ? (body.mode.trim() as DebugMode) : undefined;

export async function startDebugSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request);
    const session = await debugAgentPipeline.startSession(requireRepoId(body), ctx.tenantId, ctx.userId, optionalMode(body) ?? "debug", requireQuery(body));
    response.status(201).json(session);
  } catch (error) { next(error); }
}

export async function executeDebugStepHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const sessionId = request.params.sessionId as string; const body = getBody(request);
    const stepType = typeof body.stepType === "string" && body.stepType.trim() ? body.stepType.trim() : (() => { throw new AppError("stepType is required", "VALIDATION_ERROR", 400); })();
    const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : "Step";
    const session = debugAgentPipeline.getSession(sessionId, ctx.tenantId);
    const result = await debugAgentPipeline.executeStep({ repositoryId: session.repositoryId, tenantId: ctx.tenantId, userId: ctx.userId, sessionId: session.id, mode: session.mode, query: typeof body.query === "string" ? body.query : "" }, stepType as "isolate" | "reproduce" | "diagnose" | "fix" | "verify" | "observe", description, async () => "Step completed");
    response.status(200).json(result);
  } catch (error) { next(error); }
}

export async function runDebugHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request); const mode = optionalMode(body);
    const result = await debugOrchestrator.execute({ repositoryId: requireRepoId(body), tenantId: ctx.tenantId, userId: ctx.userId, query: requireQuery(body), ...(mode !== undefined && { mode }) });
    const extended = debugAgentPipeline.getExtendedData(result.session.id);
    response.status(200).json({ session: result.session, summary: result.summary, findings: result.findings, plan: extended?.investigationPlan, fixPlan: extended?.fixPlan, critic: extended?.criticReview });
  } catch (error) { next(error); }
}

export async function runDebugAsyncHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request); const mode = optionalMode(body);
    const session = await debugOrchestrator.startAsync({ repositoryId: requireRepoId(body), tenantId: ctx.tenantId, userId: ctx.userId, query: requireQuery(body), ...(mode !== undefined && { mode }) });
    response.status(200).json({ sessionId: session.id, session, streamUrl: `/api/debug/${session.id}/stream` });
  } catch (error) { next(error); }
}

export async function getDebugSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, ctx.tenantId); const extended = debugAgentPipeline.getExtendedData(sessionId);
    response.status(200).json({ ...session, agentState: extended?.stateMachine.getState() ?? "IDLE", plan: extended?.investigationPlan, fixPlan: extended?.fixPlan, critic: extended?.criticReview });
  } catch (error) { next(error); }
}

export async function listDebugSessionsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { response.status(200).json({ sessions: debugAgentPipeline.listSessions(getCtx(request).tenantId) }); } catch (error) { next(error); }
}

export async function listAgentRunsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = request.tenantContext; if (!ctx) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); response.status(200).json({ runs: debugAgentPipeline.listSessions(ctx.tenantId) }); } catch (error) { next(error); }
}

export async function getSessionFindingsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = getCtx(request); const sessionId = (request.params.sessionId as string) || ""; response.status(200).json(debugAgentPipeline.getSession(sessionId, ctx.tenantId).findings); } catch (error) { next(error); }
}

export async function completeDebugSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = getCtx(request); const id = (request.params.sessionId as string) || ""; debugAgentPipeline.getSession(id, ctx.tenantId); debugAgentPipeline.completeSession(id); response.status(204).send(); } catch (error) { next(error); }
}

export async function abortDebugSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const ctx = getCtx(request); const id = (request.params.sessionId as string) || ""; debugAgentPipeline.getSession(id, ctx.tenantId); debugAgentPipeline.abortSession(id); response.status(204).send(); } catch (error) { next(error); }
}

export async function streamSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, ctx.tenantId);
    response.setHeader("Content-Type", "text/event-stream"); response.setHeader("Cache-Control", "no-cache"); response.setHeader("Connection", "keep-alive"); response.flushHeaders();
    const extended = debugAgentPipeline.getExtendedData(sessionId);
    response.write(`data: ${JSON.stringify({ type: "snapshot", sessionId, session, agentState: extended?.stateMachine.getState() ?? "IDLE", plan: extended?.investigationPlan, fixPlan: extended?.fixPlan, critic: extended?.criticReview, timestamp: new Date().toISOString() })}\n\n`);
    const unsubscribe = debugAgentPipeline.subscribeToSession(sessionId, (event) => { response.write(`data: ${JSON.stringify(event)}\n\n`); });
    const heartbeat = setInterval(() => { response.write(": ping\n\n"); }, 15_000);
    request.on("close", () => { clearInterval(heartbeat); unsubscribe(); });
  } catch (error) { next(error); }
}

export async function classifyTaskHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try { const result = await classifyTask(requireQuery(getBody(request))); response.status(200).json(result); } catch (error) { next(error); }
}

export async function planTaskHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getBody(request); const repositoryId = typeof body.repositoryId === "string" ? body.repositoryId.trim() : undefined;
    const plan = await generateInvestigationPlan(requireQuery(body), repositoryId ? getExecutionPath(repositoryId) : undefined);
    response.status(200).json(plan);
  } catch (error) { next(error); }
}

export async function approveFixHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, ctx.tenantId);
    const plan = debugAgentPipeline.getExtendedData(sessionId)?.fixPlan;
    if (!plan) throw new AppError("No fix plan available in this session to approve", "VALIDATION_ERROR", 400);
    fixPlanner.approve(plan.id, ctx.userId);
    const repoPath = getExecutionPath(session.repositoryId); const changes: PatchFileChange[] = [];
    for (const fc of plan.filesToChange) {
      let originalContent = ""; try { originalContent = await fs.readFile(path.resolve(repoPath, fc.filePath), "utf-8"); } catch { originalContent = ""; }
      changes.push({ filePath: fc.filePath, originalContent, newContent: fc.patch ? applyDiffHunk(originalContent, fc.patch) : originalContent, explanation: fc.description });
    }
    const patchResult = await applyPatch(repoPath, changes, `Fix for ${plan.id}`);
    if (patchResult.success && patchResult.backupId) {
      debugAgentPipeline.setExtendedData(sessionId, { backupId: patchResult.backupId });
      debugAgentPipeline.transitionState(sessionId, "COMMITTING_CHANGES", "Fix approved and patch applied");
    }
    response.status(200).json({ status: "approved", success: patchResult.success, planId: plan.id, backupId: patchResult.backupId, appliedFiles: patchResult.appliedFiles, diff: patchResult.diff, error: patchResult.error });
  } catch (error) { next(error); }
}

export async function revertFixHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const sessionId = (request.params.sessionId as string) || "";
    debugAgentPipeline.getSession(sessionId, ctx.tenantId);
    const body = getBody(request);
    const backupId = (typeof body.backupId === "string" && body.backupId.trim() ? body.backupId.trim() : undefined) ?? debugAgentPipeline.getExtendedData(sessionId)?.backupId;
    if (!backupId) throw new AppError("No backup ID found to revert", "VALIDATION_ERROR", 400);
    const revertResult = await revertPatch(backupId);
    if (revertResult.success) debugAgentPipeline.transitionState(sessionId, "REVIEWING_DIFF", "Patch rolled back to original snapshot");
    response.status(200).json({ status: "reverted", ...revertResult });
  } catch (error) { next(error); }
}
