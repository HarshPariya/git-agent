import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import {
  validateGitHubToken,
  storeGitHubConnection,
  getGitHubToken,
  revokeGitHubConnection,
} from "../github/auth.js";
import { listGitHubRepos, getGitHubRepo, listGitHubBranches } from "../github/repositories.js";
import { listGitHubIssues, getGitHubIssue, listGitHubIssueComments } from "../github/issues.js";
import { listGitHubPRs, getGitHubPR, createGitHubPR, getPRFiles } from "../github/pull-requests.js";
import { logger } from "../logging/logger.js";

function getUserId(req: Request): string {
  return (req as unknown as { user?: { id?: string } }).user?.id ?? "anonymous";
}

// POST /api/github/connect — store GitHub token
export async function connectGitHubHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = req.body as { token?: string };
    if (!token) {
      throw new AppError("GitHub token is required", "VALIDATION_ERROR", 400);
    }

    const userId = getUserId(req);
    const info = await validateGitHubToken(token);
    storeGitHubConnection(userId, token);

    logger.info("GitHub connected", {
      operation: "github-connect",
      metadata: { userId, login: info.login },
    });

    res.status(200).json({
      connected: true,
      login: info.login,
      name: info.name,
      email: info.email,
      avatarUrl: info.avatarUrl,
    });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/github/connect — disconnect
export async function disconnectGitHubHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    revokeGitHubConnection(userId);
    res.status(200).json({ disconnected: true });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/status — check connection status
export async function githubStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const token = getGitHubToken(userId);
    if (!token) {
      res.status(200).json({ connected: false });
      return;
    }
    try {
      const info = await validateGitHubToken(token);
      res.status(200).json({ connected: true, login: info.login, name: info.name, avatarUrl: info.avatarUrl });
    } catch {
      res.status(200).json({ connected: false });
    }
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos
export async function listGitHubReposHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const page = parseInt(String(req.query["page"] ?? "1"), 10);
    const perPage = parseInt(String(req.query["per_page"] ?? "30"), 10);
    const repos = await listGitHubRepos(userId, { page, per_page: perPage });
    res.status(200).json({ repositories: repos });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo
export async function getGitHubRepoHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo } = req.params as { owner: string; repo: string };
    const repoData = await getGitHubRepo(userId, owner, repo);
    res.status(200).json(repoData);
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo/branches
export async function listGitHubBranchesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo } = req.params as { owner: string; repo: string };
    const branches = await listGitHubBranches(userId, owner, repo);
    res.status(200).json({ branches });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo/issues
export async function listGitHubIssuesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo } = req.params as { owner: string; repo: string };
    const state = (req.query["state"] as "open" | "closed" | "all") ?? "open";
    const issues = await listGitHubIssues(userId, owner, repo, { state });
    res.status(200).json({ issues });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo/issues/:number
export async function getGitHubIssueHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo, number } = req.params as { owner: string; repo: string; number: string };
    const [issue, comments] = await Promise.all([
      getGitHubIssue(userId, owner, repo, parseInt(number, 10)),
      listGitHubIssueComments(userId, owner, repo, parseInt(number, 10)),
    ]);
    res.status(200).json({ issue, comments });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo/pulls
export async function listGitHubPRsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo } = req.params as { owner: string; repo: string };
    const state = (req.query["state"] as "open" | "closed" | "all") ?? "open";
    const prs = await listGitHubPRs(userId, owner, repo, { state });
    res.status(200).json({ pullRequests: prs });
  } catch (err) {
    next(err);
  }
}

// GET /api/github/repos/:owner/:repo/pulls/:number
export async function getGitHubPRHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo, number } = req.params as { owner: string; repo: string; number: string };
    const [pr, files] = await Promise.all([
      getGitHubPR(userId, owner, repo, parseInt(number, 10)),
      getPRFiles(userId, owner, repo, parseInt(number, 10)),
    ]);
    res.status(200).json({ pullRequest: pr, files });
  } catch (err) {
    next(err);
  }
}

// POST /api/github/repos/:owner/:repo/pulls
export async function createGitHubPRHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = getUserId(req);
    const { owner, repo } = req.params as { owner: string; repo: string };
    const { title, body, head, base, draft } = req.body as {
      title: string;
      body: string;
      head: string;
      base: string;
      draft?: boolean;
    };

    if (!title || !head || !base) {
      throw new AppError("title, head, and base are required", "VALIDATION_ERROR", 400);
    }

    const pr = await createGitHubPR(userId, owner, repo, { title, body: body ?? "", head, base, draft });
    res.status(201).json({ pullRequest: pr });
  } catch (err) {
    next(err);
  }
}
