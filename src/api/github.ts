import type { Request, Response, NextFunction } from "express";
import { AppError } from "../errors/app-error.js";
import { validateGitHubToken, storeGitHubConnection, getGitHubToken, revokeGitHubConnection } from "../github/auth.js";
import { listGitHubRepos, getGitHubRepo, listGitHubBranches } from "../github/repositories.js";
import { listGitHubIssues, getGitHubIssue, listGitHubIssueComments } from "../github/issues.js";
import { listGitHubPRs, getGitHubPR, createGitHubPR, getPRFiles } from "../github/pull-requests.js";
import { logger } from "../logging/logger.js";

const getUserId = (req: Request): string =>
  req.tenantContext?.userId ?? (req as unknown as { user?: { id?: string } }).user?.id ?? "anonymous";

const requireToken = (body: unknown): string => {
  const token = (body as { token?: string })?.token;
  if (!token) throw new AppError("GitHub token is required", "VALIDATION_ERROR", 400);
  return token;
};

export async function connectGitHubHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = requireToken(req.body);
    const userId = getUserId(req);
    const info = await validateGitHubToken(token);
    storeGitHubConnection(userId, token, {
      login: info.login,
      name: info.name,
      email: info.email,
      avatarUrl: info.avatarUrl,
    });
    logger.info("GitHub connected", { operation: "github-connect", metadata: { userId, login: info.login } });
    res
      .status(200)
      .json({ connected: true, login: info.login, name: info.name, email: info.email, avatarUrl: info.avatarUrl });
  } catch (err) {
    next(err);
  }
}

export function disconnectGitHubHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    revokeGitHubConnection(getUserId(req));
    res.status(200).json({ disconnected: true });
  } catch (err) {
    next(err);
  }
}

export async function githubStatusHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = getGitHubToken(getUserId(req));
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

export async function listGitHubReposHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const pageParam = typeof req.query["page"] === "string" ? req.query["page"] : "1";
    const perPageParam = typeof req.query["per_page"] === "string" ? req.query["per_page"] : "30";
    const page = parseInt(pageParam, 10);
    const per_page = parseInt(perPageParam, 10);
    const repos = await listGitHubRepos(getUserId(req), { page, per_page });
    res.status(200).json({ repositories: repos });
  } catch (err) {
    next(err);
  }
}

export async function getGitHubRepoHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const repoData = await getGitHubRepo(getUserId(req), owner, repo);
    res.status(200).json(repoData);
  } catch (err) {
    next(err);
  }
}

export async function listGitHubBranchesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const branches = await listGitHubBranches(getUserId(req), owner, repo);
    res.status(200).json({ branches });
  } catch (err) {
    next(err);
  }
}

export async function listGitHubIssuesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const state = (req.query["state"] as "open" | "closed" | "all") ?? "open";
    const issues = await listGitHubIssues(getUserId(req), owner, repo, { state });
    res.status(200).json({ issues });
  } catch (err) {
    next(err);
  }
}

export async function getGitHubIssueHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo, number } = req.params as { owner: string; repo: string; number: string };
    const uid = getUserId(req);
    const issueNumber = parseInt(number, 10);
    const [issue, comments] = await Promise.all([
      getGitHubIssue(uid, owner, repo, issueNumber),
      listGitHubIssueComments(uid, owner, repo, issueNumber),
    ]);
    res.status(200).json({ issue, comments });
  } catch (err) {
    next(err);
  }
}

export async function listGitHubPRsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const state = (req.query["state"] as "open" | "closed" | "all") ?? "open";
    const pullRequests = await listGitHubPRs(getUserId(req), owner, repo, { state });
    res.status(200).json({ pullRequests });
  } catch (err) {
    next(err);
  }
}

export async function getGitHubPRHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo, number } = req.params as { owner: string; repo: string; number: string };
    const uid = getUserId(req);
    const prNumber = parseInt(number, 10);
    const [pullRequest, files] = await Promise.all([
      getGitHubPR(uid, owner, repo, prNumber),
      getPRFiles(uid, owner, repo, prNumber),
    ]);
    res.status(200).json({ pullRequest, files });
  } catch (err) {
    next(err);
  }
}

export async function createGitHubPRHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { owner, repo } = req.params as { owner: string; repo: string };
    const { title, body, head, base, draft } = req.body as {
      title: string;
      body: string;
      head: string;
      base: string;
      draft?: boolean;
    };
    if (!title || !head || !base) throw new AppError("title, head, and base are required", "VALIDATION_ERROR", 400);
    const prOptions: { title: string; body: string; head: string; base: string; draft?: boolean } = {
      title,
      body: body ?? "",
      head,
      base,
    };
    if (draft !== undefined) prOptions.draft = draft;
    const pullRequest = await createGitHubPR(getUserId(req), owner, repo, prOptions);
    res.status(201).json({ pullRequest });
  } catch (err) {
    next(err);
  }
}
