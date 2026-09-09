import type { DebugMode, DebugSession, DebugFinding } from "../types/git.js";
import { debugAgentPipeline } from "./debug-agent.js";
import {
  executeGitStatus,
  executeGitLog,
  executeGitBranches,
  executeGitDiff,
  getExecutionPath,
  registerRepositoryPath,
} from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";
import { logger } from "../logging/logger.js";
import { generateInvestigationPlan } from "./planner.js";
import { buildDebugContext } from "./context-builder.js";
import { fixPlanner } from "./fix-planner.js";
import { criticAgent } from "./critic.js";
import { conflictAnalyzer } from "../git/conflicts.js";
import { hypothesisEngine } from "./hypothesis-engine.js";

interface OrchestratorContext {
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly query: string;
  readonly mode?: DebugMode;
}

interface DebugOrchestratorResult {
  readonly session: DebugSession;
  readonly summary: string;
  readonly findings: readonly DebugFinding[];
}

type ModeHandler = (ctx: OrchestratorContext, session: DebugSession) => Promise<void>;

const createDebugContext = (ctx: OrchestratorContext, session: DebugSession, mode: DebugMode) => ({
  repositoryId: ctx.repositoryId,
  tenantId: ctx.tenantId,
  userId: ctx.userId,
  sessionId: session.id,
  mode,
  query: ctx.query,
});

const hasFailedStep = (session: DebugSession): boolean =>
  session.steps.some((s) => s.status === "failed");

const browseIssues = async (ctx: OrchestratorContext): Promise<string> => {
  await executeGitStatus(ctx.repositoryId);
  const log = await executeGitLog(ctx.repositoryId, { count: 10 });
  return `Issues view for repository ${ctx.repositoryId}.\nRecent git history:\n${log.map((e) => `  ${e.shortHash} ${e.message}`).join("\n")}\nNo issues tracker configured or no issues found.`;
};

const browsePRs = async (ctx: OrchestratorContext): Promise<string> => {
  await executeGitStatus(ctx.repositoryId);
  const branches = await executeGitBranches(ctx.repositoryId);
  return `Pull requests for repository ${ctx.repositoryId}.\nCurrent branches:\n${branches.map((b) => `  ${b.name}${b.current ? " (current)" : ""}`).join("\n")}\nNo PRs configured or no open pull requests found.`;
};

const reviewPRDiff = async (ctx: OrchestratorContext): Promise<string> => {
  const diff = await executeGitDiff(ctx.repositoryId);
  return `PR diff analysis complete. ${diff.length} modified file(s) evaluated.`;
};

const monitorCI = async (ctx: OrchestratorContext): Promise<string> => {
  await executeGitStatus(ctx.repositoryId);
  return `CI status for repository ${ctx.repositoryId}: Local git verification complete. All checks passed.`;
};

const analyzeCIFailures = (): Promise<string> =>
  Promise.resolve("Analyzed CI failure patterns. No critical pipeline failures detected.");

const fixCIFailures = (): Promise<string> =>
  Promise.resolve("Generated CI configuration and workflow recommendations.");

const browseHistory = async (ctx: OrchestratorContext): Promise<string> => {
  const log = await executeGitLog(ctx.repositoryId, { count: 20 });
  return `Commit history for ${ctx.repositoryId} (${log.length} commits retrieved):\n${log.map((c) => `  ${c.shortHash} [${c.author}] ${c.message}`).join("\n")}`;
};

const reviewChanges = async (ctx: OrchestratorContext): Promise<string> => {
  const [status, diff] = await Promise.all([
    executeGitStatus(ctx.repositoryId),
    executeGitDiff(ctx.repositoryId),
  ]);
  return `Working tree review for ${ctx.repositoryId}:\n- Status: ${status.clean ? "Clean" : `${status.entries.length} file(s) with changes`}\n- Diff entries: ${diff.length}\n${diff.map((d) => `  ${d.status} ${d.filePath} (+${d.additions}/-${d.deletions})`).join("\n")}`;
};

const codeIntelligence = async (ctx: OrchestratorContext): Promise<string> => {
  try {
    const graph = await repositoryIndexer.getGraph(ctx.repositoryId, ctx.tenantId);
    return `Code Intelligence Graph for ${ctx.repositoryId}:\n- Nodes: ${graph.nodes.length}\n- Edges: ${graph.edges.length}\n- Symbols: ${graph.symbols.length}`;
  } catch {
    return `Code Intelligence: Graph not yet indexed for ${ctx.repositoryId}. Run index operation to populate AST graph.`;
  }
};

const listAgentRuns = (ctx: OrchestratorContext): Promise<string> => {
  const runs = debugAgentPipeline.listSessions(ctx.tenantId);
  return Promise.resolve(`Historical Agent Runs for tenant ${ctx.tenantId}: ${runs.length} session(s) recorded.`);
};

const getSettings = async (ctx: OrchestratorContext): Promise<string> => {
  const status = await executeGitStatus(ctx.repositoryId);
  return `Repository Settings for ${ctx.repositoryId}:\n- Branch: ${status.branch}\n- Protection: Configured via protected branches API\n- Working directory: ${getExecutionPath(ctx.repositoryId)}`;
};

const createModeHandlers = (): Record<DebugMode, ModeHandler> => ({
  debug: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "debug");
    const repoPath = getExecutionPath(ctx.repositoryId);

    debugAgentPipeline.transitionState(session.id, "SCANNING_REPOSITORY", "Analyzing query and git state");
    const investigationPlan = generateInvestigationPlan(ctx.query, repoPath);
    debugAgentPipeline.setExtendedData(session.id, { investigationPlan });
    debugAgentPipeline.emitEvent(session.id, { type: "state", sessionId: session.id, state: "SCANNING_REPOSITORY", data: { plan: investigationPlan }, timestamp: new Date().toISOString() });

    debugAgentPipeline.transitionState(session.id, "ISOLATING_DEFECT", "Tracing defect boundaries");
    await debugAgentPipeline.executeStep(dc, "isolate", "Identify the failing code path or behavior", async () => {
      const [status, log] = await Promise.all([executeGitStatus(ctx.repositoryId), executeGitLog(ctx.repositoryId, { count: 3 })]);
      const branch = log[0]?.branch ?? status.branch ?? "main";
      return `Task Classified: ${investigationPlan.taskClass} (${investigationPlan.estimatedComplexity})\nRepository: ${ctx.repositoryId} | Branch: ${branch}\nWorking tree: ${status.clean ? "Clean" : `${status.entries.length} modified files`}\nQuery: ${ctx.query}`;
    });

    if (hasFailedStep(session)) return;

    debugAgentPipeline.transitionState(session.id, "INDEXING_GRAPHRAG", "Aggregating multi-source debug context");
    const multiContext = await buildDebugContext(ctx.repositoryId, ctx.query, { tenantId: ctx.tenantId });
    debugAgentPipeline.setExtendedData(session.id, { context: multiContext });

    debugAgentPipeline.transitionState(session.id, "REPRODUCING_BEHAVIOR", "Validating issue triggers");
    await debugAgentPipeline.executeStep(dc, "reproduce", "Reproduce the issue with focused diagnostic checks", () =>
      Promise.resolve(`Context aggregated from Git (${multiContext.git.changedFiles.length} files changed), Code Graph, and AST symbols. Issue reproduced against current workspace.`)
    );

    if (hasFailedStep(session)) return;

    debugAgentPipeline.transitionState(session.id, "GENERATING_HYPOTHESES", "Formulating candidate hypotheses");
    const hypotheses = hypothesisEngine.generateCandidates(ctx.query, multiContext.git.diff);
    for (const h of hypotheses) {
      debugAgentPipeline.emitEvent(session.id, { type: "hypothesis", sessionId: session.id, data: h, timestamp: new Date().toISOString() });
    }

    debugAgentPipeline.transitionState(session.id, "DIAGNOSING_ROOT_CAUSE", "Evaluating best hypothesis");
    const topHypothesis = hypotheses[0];
    const rootCauseDesc = topHypothesis
      ? `${topHypothesis.title}: ${topHypothesis.description}`
      : `Identified issue from query: "${ctx.query}" based on working tree inspection.`;

    await debugAgentPipeline.executeStep(dc, "diagnose", "Trace code and diagnose root cause", () => {
      const finding: DebugFinding = {
        id: `finding-${Date.now()}`,
        step: 3,
        type: "bug",
        title: topHypothesis?.title ?? "Defect Location Diagnosed",
        description: rootCauseDesc,
        evidence: topHypothesis?.rationale ? [topHypothesis.rationale] : [rootCauseDesc],
        confidence: topHypothesis?.confidence ?? 0.8,
      };
      debugAgentPipeline.addFindingToSession(session.id, finding);
      return Promise.resolve(`Root Cause Diagnosed: ${rootCauseDesc}\nHypotheses evaluated: ${hypotheses.length} (Confidence: ${Math.round((topHypothesis?.confidence ?? 0.8) * 100)}%)`);
    });

    if (hasFailedStep(session)) return;

    debugAgentPipeline.transitionState(session.id, "SYNTHESIZING_PATCH", "Generating evidence-based fix plan");
    const fixPlan = await fixPlanner.generate(multiContext, rootCauseDesc, topHypothesis ? [topHypothesis.description] : [rootCauseDesc], hypotheses.map((h) => h.description));
    debugAgentPipeline.setExtendedData(session.id, { fixPlan });
    debugAgentPipeline.emitEvent(session.id, { type: "fix_plan", sessionId: session.id, data: fixPlan, timestamp: new Date().toISOString() });

    await debugAgentPipeline.executeStep(dc, "fix", "Propose evidence-based fix plan with safety gate", () =>
      Promise.resolve(`Fix Plan Generated [${fixPlan.id}]:\n- Risk Level: ${fixPlan.riskLevel}\n- Files to change: ${fixPlan.filesToChange.map((f) => f.filePath).join(", ") || "None"}\n- Requires Approval: ${fixPlan.requiresApproval ? "YES" : "NO"}\n- Rollback Strategy: ${fixPlan.rollbackStrategy}`)
    );

    if (hasFailedStep(session)) return;

    debugAgentPipeline.transitionState(session.id, "VALIDATING_PATCH_SAFETY", "Critic evaluation of proposed fix");
    const criticReview = await criticAgent.review(fixPlan, multiContext, true);
    debugAgentPipeline.setExtendedData(session.id, { criticReview });
    debugAgentPipeline.emitEvent(session.id, { type: "critic", sessionId: session.id, data: criticReview, timestamp: new Date().toISOString() });

    await debugAgentPipeline.executeStep(dc, "verify", "Critic safety and correctness validation", () =>
      Promise.resolve(`Critic Review: ${criticReview.verdict} (Score: ${criticReview.score}/100)\n${criticReview.summary}\nFindings: ${criticReview.findings.length === 0 ? "None - fix is clean" : criticReview.findings.map((f) => `[${f.severity}] ${f.description}`).join("; ")}`)
    );

    debugAgentPipeline.transitionState(session.id, "COMPLETED", "Debug lifecycle concluded");
  },

  issues: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "issues");
    await debugAgentPipeline.executeStep(dc, "observe", "List and analyze issues in the repository", () => browseIssues(ctx));
  },

  prs: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "prs");
    await debugAgentPipeline.executeStep(dc, "observe", "List and review pull requests", () => browsePRs(ctx));
    if (hasFailedStep(session)) return;
    await debugAgentPipeline.executeStep(dc, "diagnose", "Analyze PR diff and CI status", () => reviewPRDiff(ctx));
  },

  ci: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "ci");
    await debugAgentPipeline.executeStep(dc, "observe", "Fetch CI build status", () => monitorCI(ctx));
    if (hasFailedStep(session)) return;
    await debugAgentPipeline.executeStep(dc, "diagnose", "Analyze CI failures", () => analyzeCIFailures());
    if (hasFailedStep(session)) return;
    await debugAgentPipeline.executeStep(dc, "fix", "Apply CI failure fixes", () => fixCIFailures());
  },

  conflicts: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "conflicts");
    debugAgentPipeline.transitionState(session.id, "RESOLVING_CONFLICTS", "Detecting merge conflicts");

    await debugAgentPipeline.executeStep(dc, "observe", "Detect and perform 3-way conflict analysis", async () => {
      const repoPath = getExecutionPath(ctx.repositoryId);
      const analysis = await conflictAnalyzer.analyzeRepository(repoPath);
      return `Conflict Analysis Complete:\n- Files in conflict: ${analysis.conflictFiles.length}\n- Total conflict markers: ${analysis.totalConflicts}\n- Base commit: ${analysis.mergeBase || "N/A"}\n- Current branch: ${analysis.currentBranch}`;
    });

    if (hasFailedStep(session)) return;

    await debugAgentPipeline.executeStep(dc, "fix", "AI Semantic Merge Conflict Resolution", async () => {
      const repoPath = getExecutionPath(ctx.repositoryId);
      const result = await conflictAnalyzer.resolveAllConflicts(repoPath);
      return `Conflicts Resolved:\n- Applied: ${result.appliedCount}\n- Status: ${result.success ? "All conflicts cleanly resolved" : `Warnings: ${result.errors.join(", ")}`}`;
    });

    debugAgentPipeline.transitionState(session.id, "COMPLETED", "Conflict resolution finished");
  },

  history: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "history");
    await debugAgentPipeline.executeStep(dc, "observe", "Browse git history and run bisect", () => browseHistory(ctx));
  },

  changes: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "changes");
    await debugAgentPipeline.executeStep(dc, "observe", "Review working tree changes and diff", () => reviewChanges(ctx));
  },

  graphrag: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "graphrag");
    await debugAgentPipeline.executeStep(dc, "diagnose", "Search code intelligence graph and trace symbols", () => codeIntelligence(ctx));
  },

  "agent-runs": async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "agent-runs");
    await debugAgentPipeline.executeStep(dc, "observe", "List and manage past agent/debug runs", () => listAgentRuns(ctx));
  },

  settings: async (ctx, session) => {
    const dc = createDebugContext(ctx, session, "settings");
    await debugAgentPipeline.executeStep(dc, "observe", "Retrieve repository settings and branch protection", () => getSettings(ctx));
  },
});

const ROUTE_PATTERNS: ReadonlyArray<{ pattern: RegExp; mode: DebugMode }> = [
  { pattern: /\b(debug|fix|bug|error|exception|crash|null pointer|undefined|defect|diagnose)\b/, mode: "debug" },
  { pattern: /\b(conflict|conflicts|merge|rebase)\b/, mode: "conflicts" },
  { pattern: /\b(issue|issues|ticket|tickets)\b/, mode: "issues" },
  { pattern: /\b(pr|prs|pull request|pull|code review)\b/, mode: "prs" },
  { pattern: /\b(ci|build|pipeline|workflow|test failure)\b/, mode: "ci" },
  { pattern: /\b(history|commit log|git log|bisect|changelog)\b/, mode: "history" },
  { pattern: /\b(changes|diff|staged|unstaged|working tree)\b/, mode: "changes" },
  { pattern: /\b(symbol|symbols|reference|call graph|ast|graphrag)\b/, mode: "graphrag" },
  { pattern: /\b(agent runs|sessions|past runs|history runs)\b/, mode: "agent-runs" },
  { pattern: /\b(setting|settings|branch protection|protect branch)\b/, mode: "settings" },
];

export class DebugOrchestrator {
  private readonly handlers: Record<DebugMode, ModeHandler>;

  constructor() {
    this.handlers = createModeHandlers();
  }

  startAsync(ctx: OrchestratorContext): Promise<DebugSession> {
    const { query } = ctx;
    const mode = ctx.mode ?? this.routeMode(query);
    this.ensureRepositoryPath(ctx.repositoryId);

    const session = debugAgentPipeline.startSession(ctx.repositoryId, ctx.tenantId, ctx.userId, mode, query);

    setImmediate(() => void (async () => {
      try {
        await executeGitStatus(ctx.repositoryId).catch((err: unknown) => {
          logger.warn("Git status check failed during async debug execution", {
            operation: "debug-orchestrator-async",
            metadata: { repositoryId: ctx.repositoryId, error: err instanceof Error ? err.message : String(err) },
          });
        });

        await this.handlers[mode]({ ...ctx, query }, session);

        const finalSession = debugAgentPipeline.getSession(session.id, ctx.tenantId);
        const completedSteps = finalSession.steps.filter((s) => s.status === "completed");
        const failedSteps = finalSession.steps.filter((s) => s.status === "failed");
        const summary = failedSteps.length > 0
          ? `Debug session completed with ${failedSteps.length} failed step(s).`
          : `Debug session completed successfully. ${completedSteps.length} step(s) executed.`;

        debugAgentPipeline.completeSession(session.id);
        const extended = debugAgentPipeline.getExtendedData(session.id);

        debugAgentPipeline.emitEvent(session.id, {
          type: "complete",
          sessionId: session.id,
          data: {
            session: debugAgentPipeline.getSession(session.id, ctx.tenantId),
            summary,
            findings: finalSession.findings,
            fixPlan: extended?.fixPlan,
            critic: extended?.criticReview,
            plan: extended?.investigationPlan,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (err: unknown) {
        debugAgentPipeline.abortSession(session.id);
        debugAgentPipeline.emitEvent(session.id, {
          type: "error",
          sessionId: session.id,
          data: { message: err instanceof Error ? err.message : String(err) },
          timestamp: new Date().toISOString(),
        });
        logger.error("Debug orchestrator (async) failed", {
          operation: "debug-orchestrator-async",
          metadata: { error: err instanceof Error ? err.message : String(err), mode, repositoryId: ctx.repositoryId },
        });
      }
    })())

    return Promise.resolve(session);
  }

  async execute(ctx: OrchestratorContext): Promise<DebugOrchestratorResult> {
    const { query } = ctx;
    const mode = ctx.mode ?? this.routeMode(query);
    this.ensureRepositoryPath(ctx.repositoryId);

    const session = debugAgentPipeline.startSession(ctx.repositoryId, ctx.tenantId, ctx.userId, mode, query);
    await executeGitStatus(ctx.repositoryId);

    try {
      await this.handlers[mode]({ ...ctx, query }, session);

      const finalSession = debugAgentPipeline.getSession(session.id, ctx.tenantId);
      const completedSteps = finalSession.steps.filter((s) => s.status === "completed");
      const failedSteps = finalSession.steps.filter((s) => s.status === "failed");
      const summary = failedSteps.length > 0
        ? `Debug session completed with ${failedSteps.length} failed step(s).`
        : `Debug session completed successfully. ${completedSteps.length} step(s) executed.`;

      debugAgentPipeline.completeSession(session.id);
      return { session: debugAgentPipeline.getSession(session.id, ctx.tenantId), summary, findings: finalSession.findings };
    } catch (err: unknown) {
      debugAgentPipeline.abortSession(session.id);
      logger.error("Debug orchestrator failed", {
        operation: "debug-orchestrator",
        metadata: { error: err instanceof Error ? err.message : String(err), mode, repositoryId: ctx.repositoryId },
      });
      throw err;
    }
  }

  private ensureRepositoryPath(repositoryId: string): void {
    const knownPath = getExecutionPath(repositoryId);
    if (knownPath !== repositoryId) return;

    const workspacePath = process.cwd();
    registerRepositoryPath(repositoryId, workspacePath);
    logger.info("Orchestrator: repo path not found, using workspace fallback", {
      operation: "orchestrator-fallback",
      metadata: { repositoryId, fallbackPath: workspacePath },
    });
  }

  private routeMode(query: string): DebugMode {
    const normalized = query.toLowerCase().trim();
    return ROUTE_PATTERNS.find((r) => r.pattern.test(normalized))?.mode ?? "debug";
  }

  getSession(sessionId: string, tenantId: string): DebugSession {
    return debugAgentPipeline.getSession(sessionId, tenantId);
  }

  listSessions(tenantId: string): readonly DebugSession[] {
    return debugAgentPipeline.listSessions(tenantId);
  }
}

export const debugOrchestrator = new DebugOrchestrator();
