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

const mapIssue = (issue: GitHubIssue): IssueSummary => ({
  id: issue.id,
  number: issue.number,
  title: issue.title,
  body: issue.body,
  state: issue.state,
  labels: issue.labels,
  author: issue.user.login,
  authorAvatar: issue.user.avatar_url,
  createdAt: issue.created_at,
  updatedAt: issue.updated_at,
  comments: issue.comments,
  isPullRequest: Boolean(issue.pull_request),
});

export const listGitHubIssues = async (
  userId: string,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; page?: number },
): Promise<IssueSummary[]> => {
  const { state = "open", page = 1 } = options ?? {};

  try {
    const issues = await makeGitHubRequest<GitHubIssue[]>(
      userId,
      `/repos/${owner}/${repo}/issues?state=${state}&per_page=30&page=${page}`,
    );
    return issues.filter((issue) => !issue.pull_request).map(mapIssue);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to list GitHub issues", { cause: error });
  }
};

export const getGitHubIssue = async (
  userId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<IssueSummary> => {
  try {
    const issue = await makeGitHubRequest<GitHubIssue>(userId, `/repos/${owner}/${repo}/issues/${issueNumber}`);
    return mapIssue(issue);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to get GitHub issue", { cause: error });
  }
};

export const listGitHubIssueComments = async (
  userId: string,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<Array<{ id: number; body: string; author: string; createdAt: string }>> => {
  try {
    const comments = await makeGitHubRequest<
      Array<{ id: number; body: string; user: { login: string }; created_at: string }>
    >(userId, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`);

    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.user.login,
      createdAt: comment.created_at,
    }));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to list GitHub issue comments", { cause: error });
  }
};
