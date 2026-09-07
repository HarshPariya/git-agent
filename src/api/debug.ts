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

export async function startDebugSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const repositoryId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
          throw new AppError("query is required", "VALIDATION_ERROR", 400);
        })();

    const mode =
      typeof body.mode === "string" && body.mode.trim()
        ? (body.mode.trim() as DebugMode)
        : undefined;

    const session = await debugAgentPipeline.startSession(
      repositoryId,
      context.tenantId,
      context.userId,
      mode ?? "debug",
      query,
    );

    response.status(201).json(session);
  } catch (error) {
    next(error);
  }
}

export async function executeDebugStepHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = request.params.sessionId as string;
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const stepType =
      typeof body.stepType === "string" && body.stepType.trim()
        ? body.stepType.trim()
        : (() => {
          throw new AppError("stepType is required", "VALIDATION_ERROR", 400);
        })();

    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : "Step";

    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const bodyQuery = typeof body.query === "string" ? body.query : "";

    const result = await debugAgentPipeline.executeStep(
      {
        repositoryId: session.repositoryId,
        tenantId: context.tenantId,
        userId: context.userId,
        sessionId: session.id,
        mode: session.mode,
        query: bodyQuery,
      },
      stepType as
      | "isolate"
      | "reproduce"
      | "diagnose"
      | "fix"
      | "verify"
      | "observe",
      description,
      async () => "Step completed",
    );

    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function runDebugHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const repositoryId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
          throw new AppError("query is required", "VALIDATION_ERROR", 400);
        })();

    const mode =
      typeof body.mode === "string" && body.mode.trim()
        ? (body.mode.trim() as DebugMode)
        : undefined;

    const result = await debugOrchestrator.execute({
      repositoryId,
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
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Async Debug Run - Starts pipeline in background, returns session immediately.
 * Frontend should open SSE stream and await the "complete" event.
 */
export async function runDebugAsyncHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const repositoryId =
      typeof body.repositoryId === "string" && body.repositoryId.trim()
        ? body.repositoryId.trim()
        : (() => {
          throw new AppError(
            "repositoryId is required",
            "VALIDATION_ERROR",
            400,
          );
        })();

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
          throw new AppError("query is required", "VALIDATION_ERROR", 400);
        })();

    const mode =
      typeof body.mode === "string" && body.mode.trim()
        ? (body.mode.trim() as DebugMode)
        : undefined;

    const session = await debugOrchestrator.startAsync({
      repositoryId,
      tenantId: context.tenantId,
      userId: context.userId,
      query,
      ...(mode !== undefined && { mode }),
    });

    response.status(200).json({
      sessionId: session.id,
      session,
      streamUrl: `/api/debug/${session.id}/stream`,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDebugSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const extended = debugAgentPipeline.getExtendedData(sessionId);

    response.status(200).json({
      ...session,
      agentState: extended?.stateMachine.getState() ?? "IDLE",
      plan: extended?.investigationPlan,
      fixPlan: extended?.fixPlan,
      critic: extended?.criticReview,
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
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessions = debugAgentPipeline.listSessions(context.tenantId);
    response.status(200).json({ sessions });
  } catch (error) {
    next(error);
  }
}

export async function listAgentRunsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context = request.tenantContext;
    if (!context) {
      throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401);
    }
    response.status(200).json({
      runs: debugAgentPipeline.listSessions(context.tenantId),
    });
  } catch (error) {
    next(error);
  }
}

export async function getSessionFindingsHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    response.status(200).json(session.findings);
  } catch (error) {
    next(error);
  }
}

export async function completeDebugSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const { sessionId } = request.params;
    const sessionIdStr = (sessionId as string) || "";
    debugAgentPipeline.getSession(sessionIdStr, context.tenantId);
    debugAgentPipeline.completeSession(sessionIdStr);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function abortDebugSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const { sessionId } = request.params;
    const sessionIdStr = (sessionId as string) || "";
    debugAgentPipeline.getSession(sessionIdStr, context.tenantId);
    debugAgentPipeline.abortSession(sessionIdStr);
    response.status(204).send();
  } catch (error) {
    next(error);
  }
}

/**
 * SSE Streaming endpoint for real-time agent updates
 */
export async function streamSessionHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);

    response.setHeader("Content-Type", "text/event-stream");
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders();

    // Send initial snapshot
    const extended = debugAgentPipeline.getExtendedData(sessionId);
    const initialData = {
      type: "snapshot",
      sessionId,
      session,
      agentState: extended?.stateMachine.getState() ?? "IDLE",
      plan: extended?.investigationPlan,
      fixPlan: extended?.fixPlan,
      critic: extended?.criticReview,
      timestamp: new Date().toISOString(),
    };
    response.write(`data: ${JSON.stringify(initialData)}\n\n`);

    // Subscribe to live events
    const unsubscribe = debugAgentPipeline.subscribeToSession(
      sessionId,
      (event) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      },
    );

    // Keep connection alive with heartbeats
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

/**
 * Task Classification endpoint
 */
export async function classifyTaskHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
          throw new AppError("query is required", "VALIDATION_ERROR", 400);
        })();

    const result = await classifyTask(query);
    response.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * Investigation Planning endpoint
 */
export async function planTaskHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const query =
      typeof body.query === "string" && body.query.trim()
        ? body.query.trim()
        : (() => {
          throw new AppError("query is required", "VALIDATION_ERROR", 400);
        })();

    const repositoryId =
      typeof body.repositoryId === "string" ? body.repositoryId.trim() : undefined;
    const repoPath = repositoryId ? getExecutionPath(repositoryId) : undefined;

    const plan = await generateInvestigationPlan(query, repoPath);
    response.status(200).json(plan);
  } catch (error) {
    next(error);
  }
}

/**
 * Fix Approval and Patch Application endpoint
 */
export async function approveFixHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = (request.params.sessionId as string) || "";
    const session = debugAgentPipeline.getSession(sessionId, context.tenantId);
    const extended = debugAgentPipeline.getExtendedData(sessionId);

    const plan = extended?.fixPlan;
    if (!plan) {
      throw new AppError(
        "No fix plan available in this session to approve",
        "VALIDATION_ERROR",
        400,
      );
    }

    // Approve the plan
    fixPlanner.approve(plan.id, context.userId);

    // Apply the patch to repository files
    const repoPath = getExecutionPath(session.repositoryId);
    const changes: PatchFileChange[] = [];

    for (const fileChange of plan.filesToChange) {
      const fullPath = path.resolve(repoPath, fileChange.filePath);
      let originalContent = "";
      try {
        originalContent = await fs.readFile(fullPath, "utf-8");
      } catch {
        originalContent = "";
      }

      // If the patch provides newContent or replacement lines
      const newContent = fileChange.patch
        ? applyDiffHunk(originalContent, fileChange.patch)
        : originalContent;

      changes.push({
        filePath: fileChange.filePath,
        originalContent,
        newContent,
        explanation: fileChange.description,
      });
    }

    const patchResult = await applyPatch(repoPath, changes, `Fix for ${plan.id}`);

    if (patchResult.success && patchResult.backupId) {
      debugAgentPipeline.setExtendedData(sessionId, {
        backupId: patchResult.backupId,
      });
      debugAgentPipeline.transitionState(
        sessionId,
        "COMMITTING_CHANGES",
        "Fix approved and patch applied",
      );
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

/**
 * Fix Revert / Rollback endpoint
 */
export async function revertFixHandler(
  request: Request,
  response: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const context =
      request.tenantContext ??
      (() => {
        throw new AppError(
          "Tenant context is missing",
          "AUTHENTICATION_ERROR",
          401,
        );
      })();

    const sessionId = (request.params.sessionId as string) || "";
    debugAgentPipeline.getSession(sessionId, context.tenantId);
    const extended = debugAgentPipeline.getExtendedData(sessionId);

    const body =
      typeof request.body === "object" && request.body !== null
        ? (request.body as Record<string, unknown>)
        : {};

    const backupId =
      typeof body.backupId === "string" && body.backupId.trim()
        ? body.backupId.trim()
        : extended?.backupId;

    if (!backupId) {
      throw new AppError("No backup ID found to revert", "VALIDATION_ERROR", 400);
    }

    const revertResult = await revertPatch(backupId);

    if (revertResult.success) {
      debugAgentPipeline.transitionState(
        sessionId,
        "REVIEWING_DIFF",
        "Patch rolled back to original snapshot",
      );
    }

    response.status(200).json({
      status: "reverted",
      ...revertResult,
    });
  } catch (error) {
    next(error);
  }
}
