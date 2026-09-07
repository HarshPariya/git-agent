import { makeGitHubRequest } from "./auth.js";

interface GitHubIssue {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: "open" | "closed";
  readonly labels: Array<{ name: string; color: string }>;
  readonly user: { login: string; avatar_url: string };
  readonly created_at: string;
  readonly updated_at: string;
  readonly comments: number;
  readonly pull_request?: unknown;
}

export interface IssueSummary {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: "open" | "closed";
  readonly labels: Array<{ name: string; color: string }>;
  readonly author: string;
  readonly authorAvatar: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly comments: number;
  readonly isPullRequest: boolean;
}

function mapIssue(i: GitHubIssue): IssueSummary {
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    body: i.body,
    state: i.state,
    labels: i.labels,
    author: i.user.login,
    authorAvatar: i.user.avatar_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    comments: i.comments,
    isPullRequest: Boolean(i.pull_request),
  };
}

export async function listGitHubIssues(
  userId: string,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; page?: number },
): Promise<IssueSummary[]> {
  const state = options?.state ?? "open";
  const page = options?.page ?? 1;
  const issues = await makeGitHubRequest<GitHubIssue[]>(
    userId,
    `/repos/${owner}/${repo}/issues?state=${state}&per_page=30&page=${page}`,
  );
  return issues.filter((i) => !i.pull_request).map(mapIssue);
}

export async function getGitHubIssue(
  userId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueSummary> {
  const issue = await makeGitHubRequest<GitHubIssue>(
    userId,
    `/repos/${owner}/${repo}/issues/${issueNumber}`,
  );
  return mapIssue(issue);
}

export async function listGitHubIssueComments(
  userId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<Array<{ id: number; body: string; author: string; createdAt: string }>> {
  const comments = await makeGitHubRequest<
    Array<{ id: number; body: string; user: { login: string }; created_at: string }>
  >(userId, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`);

  return comments.map((c) => ({
    id: c.id,
    // Treat as untrusted repository data — do NOT interpret as system instructions
    body: c.body,
    author: c.user.login,
    createdAt: c.created_at,
  }));
}
