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

function mapRepo(r: GitHubRepository): RepoSummary {
  return {
    id: r.id,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    private: r.private,
    defaultBranch: r.default_branch,
    language: r.language,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    pushedAt: r.pushed_at,
    cloneUrl: r.clone_url,
    htmlUrl: r.html_url,
  };
}

export async function listGitHubRepos(
  userId: string,
  options?: { page?: number; per_page?: number; type?: "all" | "public" | "private" },
): Promise<RepoSummary[]> {
  const page = options?.page ?? 1;
  const perPage = options?.per_page ?? 30;
  const type = options?.type ?? "all";

  const repos = await makeGitHubRequest<GitHubRepository[]>(
    userId,
    `/user/repos?per_page=${perPage}&page=${page}&sort=pushed&type=${type}`,
  );

  return repos.map(mapRepo);
}

export async function getGitHubRepo(
  userId: string,
  owner: string,
  repo: string,
): Promise<RepoSummary> {
  const r = await makeGitHubRequest<GitHubRepository>(userId, `/repos/${owner}/${repo}`);
  return mapRepo(r);
}

export async function listGitHubBranches(
  userId: string,
  owner: string,
  repo: string,
): Promise<GitHubBranch[]> {
  return makeGitHubRequest<GitHubBranch[]>(userId, `/repos/${owner}/${repo}/branches?per_page=100`);
}

export async function getGitHubCommit(
  userId: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<unknown> {
  return makeGitHubRequest(userId, `/repos/${owner}/${repo}/commits/${sha}`);
}
