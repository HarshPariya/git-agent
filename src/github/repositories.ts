import { makeGitHubRequest } from "./auth.js";

interface GitHubRepository {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly default_branch: string;
  readonly language: string | null;
  readonly stargazers_count: number;
  readonly forks_count: number;
  readonly open_issues_count: number;
  readonly pushed_at: string;
  readonly clone_url: string;
  readonly ssh_url: string;
  readonly html_url: string;
}

interface GitHubBranch {
  readonly name: string;
  readonly commit: { sha: string };
  readonly protected: boolean;
}

export interface RepoSummary {
  readonly id: number;
  readonly name: string;
  readonly fullName: string;
  readonly description: string | null;
  readonly private: boolean;
  readonly defaultBranch: string;
  readonly language: string | null;
  readonly stars: number;
  readonly forks: number;
  readonly openIssues: number;
  readonly pushedAt: string;
  readonly cloneUrl: string;
  readonly htmlUrl: string;
}

const mapRepo = (repo: GitHubRepository): RepoSummary => ({
  id: repo.id,
  name: repo.name,
  fullName: repo.full_name,
  description: repo.description,
  private: repo.private,
  defaultBranch: repo.default_branch,
  language: repo.language,
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  openIssues: repo.open_issues_count,
  pushedAt: repo.pushed_at,
  cloneUrl: repo.clone_url,
  htmlUrl: repo.html_url,
});

export const listGitHubRepos = async (
  userId: string,
  options?: { page?: number; per_page?: number; type?: "all" | "public" | "private" },
): Promise<RepoSummary[]> => {
  const { page = 1, per_page: perPage = 30, type = "all" } = options ?? {};

  try {
    const repos = await makeGitHubRequest<GitHubRepository[]>(
      userId,
      `/user/repos?per_page=${perPage}&page=${page}&sort=pushed&type=${type}`,
    );
    return repos.map(mapRepo);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to list GitHub repositories");
  }
};

export const getGitHubRepo = async (userId: string, owner: string, repo: string): Promise<RepoSummary> => {
  try {
    const repoData = await makeGitHubRequest<GitHubRepository>(userId, `/repos/${owner}/${repo}`);
    return mapRepo(repoData);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to get GitHub repository");
  }
};

export const listGitHubBranches = async (userId: string, owner: string, repo: string): Promise<GitHubBranch[]> => {
  try {
    return await makeGitHubRequest<GitHubBranch[]>(userId, `/repos/${owner}/${repo}/branches?per_page=100`);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to list GitHub branches");
  }
};

export const getGitHubCommit = async (userId: string, owner: string, repo: string, sha: string): Promise<unknown> => {
  try {
    return await makeGitHubRequest(userId, `/repos/${owner}/${repo}/commits/${sha}`);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Failed to get GitHub commit");
  }
};
