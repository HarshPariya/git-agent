import { makeGitHubRequest } from "./auth.js";

interface GitHubPR {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: "open" | "closed" | "merged";
  readonly merged: boolean;
  readonly head: { ref: string; sha: string };
  readonly base: { ref: string; sha: string };
  readonly user: { login: string; avatar_url: string };
  readonly created_at: string;
  readonly updated_at: string;
  readonly commits: number;
  readonly additions: number;
  readonly deletions: number;
  readonly changed_files: number;
  readonly html_url: string;
}

export interface PRSummary {
  readonly id: number;
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly state: string;
  readonly headBranch: string;
  readonly headSha: string;
  readonly baseBranch: string;
  readonly author: string;
  readonly authorAvatar: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly commits: number;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly htmlUrl: string;
}

const mapPR = (pr: GitHubPR): PRSummary => ({
  id: pr.id,
  number: pr.number,
  title: pr.title,
  body: pr.body,
  state: pr.merged ? "merged" : pr.state,
  headBranch: pr.head.ref,
  headSha: pr.head.sha,
  baseBranch: pr.base.ref,
  author: pr.user.login,
  authorAvatar: pr.user.avatar_url,
  createdAt: pr.created_at,
  updatedAt: pr.updated_at,
  commits: pr.commits,
  additions: pr.additions,
  deletions: pr.deletions,
  changedFiles: pr.changed_files,
  htmlUrl: pr.html_url,
});

export const listGitHubPRs = async (
  userId: string,
  owner: string,
  repo: string,
  options?: { state?: "open" | "closed" | "all"; page?: number },
): Promise<PRSummary[]> => {
  const { state = "open", page = 1 } = options ?? {};

  try {
    const prs = await makeGitHubRequest<GitHubPR[]>(
      userId,
      `/repos/${owner}/${repo}/pulls?state=${state}&per_page=30&page=${page}`,
    );
    return prs.map(mapPR);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to list GitHub pull requests", { cause: error });
  }
};

export const getGitHubPR = async (
  userId: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRSummary> => {
  try {
    const pr = await makeGitHubRequest<GitHubPR>(userId, `/repos/${owner}/${repo}/pulls/${prNumber}`);
    return mapPR(pr);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to get GitHub pull request", { cause: error });
  }
};

export const createGitHubPR = async (
  userId: string,
  owner: string,
  repo: string,
  data: { title: string; body: string; head: string; base: string; draft?: boolean },
): Promise<PRSummary> => {
  try {
    const pr = await makeGitHubRequest<GitHubPR>(userId, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify(data),
    });
    return mapPR(pr);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to create GitHub pull request", { cause: error });
  }
};

export const getPRFiles = async (
  userId: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>> => {
  try {
    return await makeGitHubRequest(userId, `/repos/${owner}/${repo}/pulls/${prNumber}/files`);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to get pull request files", { cause: error });
  }
};
