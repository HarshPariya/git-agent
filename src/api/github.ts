import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import { validateGitHubToken, storeGitHubConnection, getGitHubToken, revokeGitHubConnection } from "../github/auth.js";
import { listGitHubRepos, getGitHubRepo, listGitHubBranches } from "../github/repositories.js";
import { listGitHubIssues, getGitHubIssue, listGitHubIssueComments } from "../github/issues.js";
import { listGitHubPRs, getGitHubPR, createGitHubPR, getPRFiles } from "../github/pull-requests.js";
import { logger } from "../logging/logger.js";

const getUserId = (req: Request) => (req as unknown as { user?: { id?: string } }).user?.id ?? "anonymous";

export async function connectGitHubHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token } = req.body as { token?: string };
    if (!token) throw new AppError("GitHub token is required", "VALIDATION_ERROR", 400);
    const userId = getUserId(req); const info = await validateGitHubToken(token); storeGitHubConnection(userId, token);
    logger.info("GitHub connected", { operation: "github-connect", metadata: { userId, login: info.login } });
    res.status(200).json({ connected: true, login: info.login, name: info.name, email: info.email, avatarUrl: info.avatarUrl });
  } catch (err) { next(err); }
}

export async function disconnectGitHubHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { revokeGitHubConnection(getUserId(req)); res.status(200).json({ disconnected: true }); } catch (err) { next(err); }
}

export async function githubStatusHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getGitHubToken(getUserId(req));
    if (!token) { res.status(200).json({ connected: false }); return; }
    try { const info = await validateGitHubToken(token); res.status(200).json({ connected: true, login: info.login, name: info.name, avatarUrl: info.avatarUrl }); } catch { res.status(200).json({ connected: false }); }
  } catch (err) { next(err); }
}

export async function listGitHubReposHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const repos = await listGitHubRepos(getUserId(req), { page: parseInt(String(req.query["page"] ?? "1"), 10), per_page: parseInt(String(req.query["per_page"] ?? "30"), 10) }); res.status(200).json({ repositories: repos }); } catch (err) { next(err); }
}

export async function getGitHubRepoHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo } = req.params as { owner: string; repo: string }; res.status(200).json(await getGitHubRepo(getUserId(req), owner, repo)); } catch (err) { next(err); }
}

export async function listGitHubBranchesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo } = req.params as { owner: string; repo: string }; res.status(200).json({ branches: await listGitHubBranches(getUserId(req), owner, repo) }); } catch (err) { next(err); }
}

export async function listGitHubIssuesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo } = req.params as { owner: string; repo: string }; res.status(200).json({ issues: await listGitHubIssues(getUserId(req), owner, repo, { state: (req.query["state"] as "open" | "closed" | "all") ?? "open" }) }); } catch (err) { next(err); }
}

export async function getGitHubIssueHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo, number } = req.params as { owner: string; repo: string; number: string }; const uid = getUserId(req); const [issue, comments] = await Promise.all([getGitHubIssue(uid, owner, repo, parseInt(number, 10)), listGitHubIssueComments(uid, owner, repo, parseInt(number, 10))]); res.status(200).json({ issue, comments }); } catch (err) { next(err); }
}

export async function listGitHubPRsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo } = req.params as { owner: string; repo: string }; res.status(200).json({ pullRequests: await listGitHubPRs(getUserId(req), owner, repo, { state: (req.query["state"] as "open" | "closed" | "all") ?? "open" }) }); } catch (err) { next(err); }
}

export async function getGitHubPRHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { const { owner, repo, number } = req.params as { owner: string; repo: string; number: string }; const uid = getUserId(req); const [pr, files] = await Promise.all([getGitHubPR(uid, owner, repo, parseInt(number, 10)), getPRFiles(uid, owner, repo, parseInt(number, 10))]); res.status(200).json({ pullRequest: pr, files }); } catch (err) { next(err); }
}

export async function createGitHubPRHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string }; const { title, body, head, base, draft } = req.body as { title: string; body: string; head: string; base: string; draft?: boolean };
    if (!title || !head || !base) throw new AppError("title, head, and base are required", "VALIDATION_ERROR", 400);
    res.status(201).json({ pullRequest: await createGitHubPR(getUserId(req), owner, repo, { title, body: body ?? "", head, base, draft }) });
  } catch (err) { next(err); }
}
