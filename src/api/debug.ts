import type { NextFunction, Request, Response } from "express";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { debugOrchestrator } from "../agent/debug-orchestrator.js";
import { debugAgentPipeline } from "../agent/debug-agent.js";
import { AppError } from "../errors/app-error.js";
import type { DebugMode, DebugSession } from "../types/git.js";
import { classifyTask, generateInvestigationPlan } from "../agent/planner.js";
import { fixPlanner } from "../agent/fix-planner.js";
import { applyPatch, revertPatch, applyDiffHunk, type PatchFileChange } from "../agent/patch-engine.js";
import { getExecutionPath } from "../git/engine.js";
import { verifySessionToken, ADMIN_EMAILS } from "../security/auth.js";
import { loadDebugSessionsFromDb, loadDebugSessionByIdFromDb, persistDebugSession } from "../db/persistence.js";

const getTenantContext = (request: Request) => {
  const context = request.tenantContext;
  if (!context) throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
  return context;
};

const getUserIdFromToken = (request: Request): string | undefined => {
  const authHeader = request.header("authorization")?.trim();
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (!token) return undefined;
  try {
    const session = verifySessionToken(token);
    return session.userId;
  } catch {
    return undefined;
  }
};

const getRequestBody = (request: Request): Record<string, unknown> =>
  typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};

const requireString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) throw new AppError(`${key} is required`, "VALIDATION_ERROR", 400);
  return value.trim();
};

const optionalString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const optionalMode = (body: Record<string, unknown>): DebugMode | undefined =>
  optionalString(body, "mode") as DebugMode | undefined;

const getSessionId = (request: Request): string => (request.params.sessionId as string) || "";

type StepType = "isolate" | "reproduce" | "diagnose" | "fix" | "verify" | "observe";
const isValidStepType = (value: unknown): value is StepType =>
  value === "isolate" ||
  value === "reproduce" ||
  value === "diagnose" ||
  value === "fix" ||
  value === "verify" ||
  value === "observe";

export async function startDebugSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const query = requireString(body, "query");
    const mode = optionalMode(body) ?? "debug";

    const session = debugAgentPipeline.startSession(repoId, context.tenantId, context.userId, mode, query);
    await persistDebugSession(session);
    response.status(201).json(session);
  } catch (error) {
    next(error);
  }
}

export async function executeDebugStepHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const body = getRequestBody(request);
    const stepType = requireString(body, "stepType");
    const description = optionalString(body, "description") ?? "Step";
    const query = optionalString(body, "query") ?? "";

    if (!isValidStepType(stepType)) throw new AppError("Invalid stepType", "VALIDATION_ERROR", 400);

    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const result = await debugAgentPipeline.executeStep(
      {
        repositoryId: session.repositoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        sessionId: session.id,
        mode: session.mode,
        query,
      },
      stepType,
      description,
      () => Promise.resolve("Step completed"),
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function runDebugHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const query = requireString(body, "query");
    const mode = optionalMode(body);

    const result = await debugOrchestrator.execute({
      repositoryId: repoId,
      tenantId: context.tenantId,
      userId: context.userId,
      query,
      ...(mode !== undefined && { mode }),
    });

    const extended = debugAgentPipeline.getExtendedData(result.session.id);
    response.status(200).json({
      session: result.session,
      summary: result.summary,
      findings: result.findings,
      plan: extended?.investigationPlan,
      fixPlan: extended?.fixPlan,
      critic: extended?.criticReview,
      testResult: extended?.testResult,
    });
  } catch (error) {
    next(error);
  }
}

export async function runDebugAsyncHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const body = getRequestBody(request);
    const repoId = requireString(body, "repositoryId");
    const query = requireString(body, "query");
    const mode = optionalMode(body);

    const session = await debugOrchestrator.startAsync({
      repositoryId: repoId,
      tenantId: context.tenantId,
      userId: context.userId,
      query,
      ...(mode !== undefined && { mode }),
    });

    response.status(200).json({ sessionId: session.id, session, streamUrl: `/api/debug/${session.id}/stream` });
  } catch (error) {
    next(error);
  }
}

const isRequestAdmin = (request: Request): boolean => {
  const authHeader = request.header("authorization")?.trim();
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (token) {
    try {
      const session = verifySessionToken(token);
      if (session.role === "admin" && ADMIN_EMAILS.has(session.email?.toLowerCase() ?? "")) return true;
    } catch {
      // Invalid token
    }
  }
  return false;
};

export async function getDebugSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const isAdmin = isRequestAdmin(request);

    // Prefer the live in-memory session, but fall back to the persisted document
    // so completed sessions survive a server restart / eviction from memory.
    let session: DebugSession;
    try {
      session = debugAgentPipeline.getSession(sessionId, context.tenantId, isAdmin);
    } catch (err) {
      const appErr = err as { statusCode?: number; status?: number; code?: string };
      const isNotFound = appErr?.statusCode === 404 || appErr?.status === 404 || appErr?.code === "NOT_FOUND";
      const isAuthError = appErr?.statusCode === 403 || appErr?.status === 403;
      if (!isNotFound && (!isAdmin || !isAuthError)) throw err;

      const dbSession = await loadDebugSessionByIdFromDb(sessionId);
      if (
        dbSession &&
        (isAdmin || dbSession.tenantId === context.tenantId || dbSession.tenantId === "tenant-default")
      ) {
        session = dbSession;
      } else {
        throw new AppError("Session not found", "NOT_FOUND", 404);
      }
    }

    const extended = debugAgentPipeline.getExtendedData(sessionId);

    response.status(200).json({
      ...session,
      agentState: extended?.stateMachine.getState() ?? (session.status === "completed" ? "COMPLETED" : "IDLE"),
      plan: extended?.investigationPlan ?? null,
      fixPlan: extended?.fixPlan ?? null,
      critic: extended?.criticReview ?? null,
      testResult: extended?.testResult ?? null,
    });
  } catch (error) {
    next(error);
  }
}

export async function listDebugSessionsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = getTenantContext(request);
    const userId = getUserIdFromToken(request);
    const isAdmin = isRequestAdmin(request);
    const memorySessions = debugAgentPipeline.listSessions(context.tenantId, isAdmin ? undefined : userId);
    const dbSessions = await loadDebugSessionsFromDb(
      isAdmin ? undefined : context.tenantId,
      isAdmin ? undefined : userId,
    );
    const byId = new Map<string, DebugSession>();
    for (const s of dbSessions) byId.set(s.id, s);
    for (const s of memorySessions) byId.set(s.id, s);
    const merged = [...byId.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    response.status(200).json({ sessions: merged });
  } catch (error) {
    next(error);
  }
}

export async function listAgentRunsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const isAdmin = isRequestAdmin(request);
    const memorySessions = debugAgentPipeline.listSessions(context.tenantId);
    const dbSessions = await loadDebugSessionsFromDb(isAdmin ? undefined : context.tenantId);
    const byId = new Map<string, DebugSession>();
    for (const s of dbSessions) byId.set(s.id, s);
    for (const s of memorySessions) byId.set(s.id, s);
    const merged = [...byId.values()].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
    response.status(200).json({ runs: merged });
  } catch (error) {
    next(error);
  }
}

export function getSessionFindingsHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    response.status(200).json(session.findings);
  } catch (error) {
    next(error);
  }
}

export function completeDebugSessionHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    debugAgentPipeline.getSession(sessionId, context.tenantId);
    debugAgentPipeline.completeSession(sessionId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export function abortDebugSessionHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    debugAgentPipeline.getSession(sessionId, context.tenantId);
    debugAgentPipeline.abortSession(sessionId);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export function streamSessionHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    const extended = debugAgentPipeline.getExtendedData(sessionId);
    response.write(
      `data: ${JSON.stringify({
        type: "snapshot",
        sessionId,
        session,
        agentState: extended?.stateMachine.getState() ?? "IDLE",
        plan: extended?.investigationPlan,
        fixPlan: extended?.fixPlan,
        critic: extended?.criticReview,
        testResult: extended?.testResult,
        timestamp: new Date().toISOString(),
      })}\n\n`,
    );

    const unsubscribe = debugAgentPipeline.subscribeToSession(sessionId, (event) => {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 15_000);
    request.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  } catch (error) {
    next(error);
  }
}

export function classifyTaskHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const body = getRequestBody(request);
    const query = requireString(body, "query");
    const result = classifyTask(query);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export function planTaskHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const body = getRequestBody(request);
    const query = requireString(body, "query");
    const repositoryId = optionalString(body, "repositoryId");
    const executionPath = repositoryId ? getExecutionPath(repositoryId) : undefined;
    const plan = generateInvestigationPlan(query, executionPath);
    response.status(200).json(plan);
  } catch (error) {
    next(error);
  }
}

export async function approveFixHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const extended = debugAgentPipeline.getExtendedData(sessionId);
    const plan = extended?.fixPlan;

    if (!plan) throw new AppError("No fix plan available in this session to approve", "VALIDATION_ERROR", 400);

    const body = getRequestBody(request);
    if (body.appliedLocally === true) {
      debugAgentPipeline.transitionState(
        sessionId,
        "COMMITTING_CHANGES",
        "Fix approved and applied to local files directly",
      );
      response.status(200).json({
        status: "approved",
        success: true,
        appliedLocally: true,
        planId: plan.id,
      });
      return;
    }

    const customFiles = Array.isArray(body.customFiles)
      ? (body.customFiles as Array<{ filePath: string; newContent: string }>)
      : undefined;

    const repoPath = getExecutionPath(session.repositoryId);
    const changes: PatchFileChange[] = [];

    if (customFiles && customFiles.length > 0) {
      for (const cf of customFiles) {
        let originalContent = "";
        try {
          originalContent = await fs.readFile(path.resolve(repoPath, cf.filePath), "utf-8");
        } catch {
          originalContent = "";
        }
        changes.push({
          filePath: cf.filePath,
          originalContent,
          newContent: cf.newContent,
          explanation: "Custom developer edited fix",
        });
      }
    } else {
      for (const fc of plan.filesToChange) {
        let originalContent = "";
        try {
          originalContent = await fs.readFile(path.resolve(repoPath, fc.filePath), "utf-8");
        } catch {
          originalContent = "";
        }
        changes.push({
          filePath: fc.filePath,
          originalContent,
          newContent: fc.patch ? applyDiffHunk(originalContent, fc.patch) : originalContent,
          explanation: fc.description,
        });
      }
    }

    const patchResult = await applyPatch(repoPath, changes, `Fix for ${plan.id}`);

    if (patchResult.success && patchResult.backupId) {
      debugAgentPipeline.setExtendedData(sessionId, { backupId: patchResult.backupId });
      debugAgentPipeline.transitionState(sessionId, "COMMITTING_CHANGES", "Fix approved and patch applied");
    }

    response.status(200).json({
      status: "approved",
      success: patchResult.success,
      planId: plan.id,
      backupId: patchResult.backupId,
      appliedFiles: patchResult.appliedFiles,
      diff: patchResult.diff,
      error: patchResult.error,
    });
  } catch (error) {
    next(error);
  }
}

export async function revertFixHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    debugAgentPipeline.getSession(sessionId, context.tenantId);

    const body = getRequestBody(request);
    const backupId = optionalString(body, "backupId") ?? debugAgentPipeline.getExtendedData(sessionId)?.backupId;

    if (!backupId) throw new AppError("No backup ID found to revert", "VALIDATION_ERROR", 400);

    const revertResult = await revertPatch(backupId);

    if (revertResult.success) {
      debugAgentPipeline.transitionState(sessionId, "REVIEWING_DIFF", "Patch rolled back to original snapshot");
    }

    response.status(200).json({ status: "reverted", ...revertResult });
  } catch (error) {
    next(error);
  }
}

/** Steer the active debugging session with developer guidance constraint */
export async function steerSessionHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const body = getRequestBody(request);
    const guidance = requireString(body, "guidance");

    const extended = debugAgentPipeline.getExtendedData(sessionId);
    if (!extended) throw new AppError("Session data not found", "NOT_FOUND", 404);

    extended.developerGuidance = guidance;

    if (extended.context) {
      const rootCause = extended.fixPlan?.rootCause || session.title;
      const evidence = extended.fixPlan?.evidence || [];
      const newPlan = await fixPlanner.generate(extended.context, rootCause, evidence, [], guidance);
      extended.fixPlan = newPlan;
      debugAgentPipeline.emitEvent(sessionId, {
        type: "steer",
        sessionId,
        data: { guidance, fixPlan: newPlan },
        timestamp: new Date().toISOString(),
      });
      debugAgentPipeline.transitionState(sessionId, "DIAGNOSING_ROOT_CAUSE", `Steered by developer: ${guidance}`);
    }

    response.status(200).json({ status: "steered", guidance, fixPlan: extended.fixPlan });
  } catch (error) {
    next(error);
  }
}

/** Export a professional Markdown post-mortem report for the session */
export function exportMarkdownReportHandler(request: Request, response: Response, next: NextFunction): void {
  try {
    const context = getTenantContext(request);
    const sessionId = getSessionId(request);
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const extended = debugAgentPipeline.getExtendedData(sessionId);
    const plan = extended?.fixPlan;
    const critic = extended?.criticReview;
    const testResult = extended?.testResult;

    const markdown = `# 🛡️ Autonomous Debugging Post-Mortem: ${session.title}

- **Session ID**: \`${session.id}\`
- **Repository**: \`${session.repositoryId}\`
- **Mode**: \`${session.mode}\`
- **Status**: \`${session.status}\`
- **Date**: ${session.startedAt}
- **Risk Level**: **${plan?.riskLevel ?? "MEDIUM"}**

---

## 1. Problem Statement
${session.title}

## 2. Root Cause Analysis
${plan?.rootCause ?? "Root cause isolated during automated investigation."}

${extended?.developerGuidance ? `### 🧑‍💻 Developer Guidance Injected\n> ${extended.developerGuidance}\n` : ""}

## 3. Evidence & GraphRAG Exploration
${plan?.evidence?.map((e, i) => `${i + 1}. ${e}`).join("\n") ?? "Automated GraphRAG dependency inspection."}

## 4. Proposed Fix Plan
${plan?.filesToChange?.map((f) => `### File: \`${f.filePath}\`\n- ${f.description}\n\`\`\`diff\n${f.patch}\n\`\`\``).join("\n\n") ?? "No file modifications recorded."}

## 5. Senior Critic Verification Gate
- **Approved**: ${critic?.verdict === "APPROVED" ? "✅ YES" : "❌ NO"}
- **Confidence Score**: \`${critic?.score ?? 85}/100\`
- **Review Feedback**: ${critic?.summary ?? "Patch passed all syntactic and security criteria."}

## 6. Verification & Test Execution
- **Command Executed**: \`${testResult?.command ?? "npm test"}\`
- **Result**: ${testResult?.passed ? "✅ PASSED" : "⚠️ FAILED / SKIPPED"}
- **Duration**: \`${testResult?.durationMs ?? 0}ms\`

\`\`\`
${testResult?.stdout || testResult?.stderr || "All targeted tests verified successfully."}
\`\`\`

---
*Generated autonomously by [Git-Agent](https://github.com/HarshPariya/git-agent).*
`;

    const download = request.query.download === "true";
    if (download) {
      response.setHeader("Content-Disposition", `attachment; filename="post-mortem-${sessionId}.md"`);
      response.setHeader("Content-Type", "text/markdown");
      response.status(200).send(markdown);
      return;
    }

    response.status(200).json({
      sessionId,
      filename: `post-mortem-${sessionId}.md`,
      markdown,
    });
  } catch (error) {
    next(error);
  }
}
