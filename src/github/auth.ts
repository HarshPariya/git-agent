import crypto from "node:crypto";
import { AppError } from "../errors/app-error.js";
import { persistGitHubConnection, deleteGitHubConnection, loadGitHubConnectionsFromDb } from "../db/persistence.js";

interface GitHubTokenInfo {
  readonly token: string;
  readonly login: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string;
}

const tokenStore = new Map<string, { githubToken: string; userId: string; connectedAt: string }>();

export const generateConnectionId = (): string => crypto.randomUUID();

export const storeGitHubConnection = (
  userId: string,
  githubToken: string,
  metadata?: { login?: string; name?: string; email?: string; avatarUrl?: string },
): string => {
  const connectionId = generateConnectionId();
  tokenStore.set(connectionId, { githubToken, userId, connectedAt: new Date().toISOString() });
  void persistGitHubConnection(userId, githubToken, connectionId, metadata);
  return connectionId;
};

export const getGitHubToken = (userId: string): string | undefined => {
  const connection = [...tokenStore.values()].find((conn) => conn.userId === userId);
  return connection?.githubToken;
};

export const revokeGitHubConnection = (userId: string): void => {
  for (const [id, conn] of tokenStore.entries()) {
    if (conn.userId === userId) tokenStore.delete(id);
  }
  void deleteGitHubConnection(userId);
};

export const hydrateGitHubTokensFromDb = async (): Promise<void> => {
  try {
    const connections = await loadGitHubConnectionsFromDb();
    for (const conn of connections) {
      if (conn.userId && conn.githubToken) {
        tokenStore.set(conn.connectionId, {
          githubToken: conn.githubToken,
          userId: conn.userId,
          connectedAt: conn.connectedAt,
        });
      }
    }
  } catch {
    // Non-fatal
  }
};

export const validateGitHubToken = async (token: string): Promise<GitHubTokenInfo> => {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "GitDebuggingAgent/1.0",
      },
    });

    if (!response.ok) throw new AppError("Invalid GitHub token or insufficient permissions", "GITHUB_ERROR", 401);

    const data = (await response.json()) as {
      login: string;
      name: string | null;
      email: string | null;
      avatar_url: string;
    };

    return {
      token,
      login: data.login,
      name: data.name ?? data.login,
      email: data.email ?? "",
      avatarUrl: data.avatar_url,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to validate GitHub token", "GITHUB_ERROR", 500);
  }
};

export const makeGitHubRequest = async <T>(userId: string, path: string, options?: RequestInit): Promise<T> => {
  try {
    const token = getGitHubToken(userId);
    if (!token) throw new AppError("GitHub not connected. Please connect your GitHub account.", "GITHUB_ERROR", 401);

    const url = path.startsWith("https://") ? path : `https://api.github.com${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
        "Content-Type": "application/json",
        "User-Agent": "GitDebuggingAgent/1.0",
        ...(options?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new AppError(
        `GitHub API error ${response.status}: ${errorText}`,
        "GITHUB_ERROR",
        response.status >= 500 ? 502 : response.status,
      );
    }

    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("Failed to make GitHub request", "GITHUB_ERROR", 500);
  }
};
