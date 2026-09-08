import "dotenv/config";
import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error.js";
import { executeGitStatus } from "../git/engine.js";
import type { PullRequest, PullRequestReviewer } from "../types/git.js";
import crypto from "node:crypto";

const pullRequests = new Map<string, PullRequest>();

const DEFAULT_PR_ID = "pr-git-agent-01";
pullRequests.set(DEFAULT_PR_ID, {
  id: DEFAULT_PR_ID, repositoryId: "repo-ai-chatbot", number: 12,
  title: "feat(git-agent): production git debugging agent, executive post-push summary & commit plan",
  description: "### Production Git Debugging Agent Enhancements\n\n**Source Branch:** `feature/git-agent`\n**Target Branch:** `development`\n\n#### Commits Included:\n- `fb630e1`: feat(ui): show clean tree status and push summary after push\n- `8a5d423`: feat(git): add commit, branch, and push enhancements\n\n#### Key Improvements:\n1. Executive Post-Push Summary card & clean working tree status.\n2. Resolved Windows cmd.exe '%h' log pipe issue in Git Engine.\n3. Continuous 'All Changes' unified diff viewer across modified files.\n4. Relocated AI Semantic Commit Plan into left panel tab.\n5. Production-ready Conventional Commit generation via Groq LLM.\n6. Direct OS file dialog and drag-and-drop workspace integration.",
  status: "open", sourceBranch: "feature/git-agent", targetBranch: "development", author: "HarshPariya",
  reviewers: [{ user: "ai-debugging-agent", status: "approved" }],
  baseSha: "e552d8c", headSha: "fb630e1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  labels: ["enhancement", "verified", "git-agent"],
});

const getCtx = (req: Request) => req.tenantContext ?? (() => { throw new AppError("Tenant context is missing", "AUTHENTICATION_ERROR", 401); })();
const getBody = (req: Request) => (typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : {});
const requireRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : (() => { throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400); })();
const optionalStr = (body: Record<string, unknown>, key: string, fallback?: string) => typeof body[key] === "string" && (body[key] as string).trim() ? (body[key] as string).trim() : fallback;

const matchesRepo = (pr: PullRequest, repoId?: string) => !repoId || pr.repositoryId === repoId || (pr.id === DEFAULT_PR_ID && (repoId.includes("ai-chatbot") || repoId.startsWith("repo-")));

export async function listPullRequestsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getCtx(request);
    const queryRepo = typeof request.query.repositoryId === "string" ? request.query.repositoryId.trim() : undefined;
    const body = getBody(request);
    const repoId = queryRepo || (typeof body.repositoryId === "string" ? body.repositoryId.trim() : undefined);
    const stateFilter = typeof request.query.state === "string" ? request.query.state.trim() : undefined;
    if (repoId) try { await executeGitStatus(repoId); } catch { /* synthetic id fallback */ }
    let prs = [...pullRequests.values()].filter((pr) => matchesRepo(pr, repoId));
    if (stateFilter && stateFilter !== "all") prs = prs.filter((pr) => pr.status === stateFilter);
    response.status(200).json({ pullRequests: prs });
  } catch (error) { next(error); }
}

export async function getPullRequestHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getCtx(request); const pr = pullRequests.get((request.params.id as string) || "");
    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);
    if (pr.repositoryId) await executeGitStatus(pr.repositoryId);
    response.status(200).json(pr);
  } catch (error) { next(error); }
}

export async function createPullRequestHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = getCtx(request); const body = getBody(request); const repoId = requireRepoId(body);
    try { await executeGitStatus(repoId); } catch { /* synthetic fallback */ }
    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : (() => { throw new AppError("title is required", "VALIDATION_ERROR", 400); })();
    const sourceBranch = typeof body.sourceBranch === "string" && body.sourceBranch.trim() ? body.sourceBranch.trim() : (() => { throw new AppError("sourceBranch is required", "VALIDATION_ERROR", 400); })();
    const targetBranch = optionalStr(body, "targetBranch", "main");
    const now = new Date().toISOString(); const prId = `pr-${crypto.randomUUID().slice(0, 8)}`;
    const pr: PullRequest = { id: prId, repositoryId: repoId, number: Math.floor(Math.random() * 10000) + 1, title, description: typeof body.description === "string" ? body.description : "", status: "open", sourceBranch, targetBranch: targetBranch ?? "main", author: ctx.userId, reviewers: [], baseSha: "", headSha: "", createdAt: now, updatedAt: now, labels: Array.isArray(body.labels) ? (body.labels as string[]) : [] };
    pullRequests.set(prId, pr); response.status(201).json(pr);
  } catch (error) { next(error); }
}

export async function mergePullRequestHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getCtx(request); const pr = pullRequests.get((request.params.id as string) || "");
    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);
    if (pr.repositoryId) await executeGitStatus(pr.repositoryId);
    const merged: PullRequest = { ...pr, status: "merged", updatedAt: new Date().toISOString(), mergedAt: new Date().toISOString() };
    pullRequests.set((request.params.id as string) || "", merged); response.status(200).json(merged);
  } catch (error) { next(error); }
}

export async function addPrReviewerHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    getCtx(request); const body = getBody(request);
    const reviewer = typeof body.reviewer === "string" && body.reviewer.trim() ? body.reviewer.trim() : (() => { throw new AppError("reviewer is required", "VALIDATION_ERROR", 400); })();
    const pr = pullRequests.get((request.params.id as string) || "");
    if (!pr) throw new AppError("Pull request not found", "NOT_FOUND", 404);
    if (pr.repositoryId) await executeGitStatus(pr.repositoryId);
    const updated: PullRequest = { ...pr, reviewers: [...pr.reviewers, { user: reviewer, status: "pending" } as PullRequestReviewer], updatedAt: new Date().toISOString() };
    pullRequests.set((request.params.id as string) || "", updated); response.status(200).json(updated);
  } catch (error) { next(error); }
}
