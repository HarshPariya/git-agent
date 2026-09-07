import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Repository } from "../types/git.js";
import { AppError } from "../errors/app-error.js";

const execFileAsync = promisify(execFile);

interface BisectResult {
  readonly commit: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
  readonly isBad: boolean;
  readonly isGood: boolean;
}

interface RegressionResult {
  readonly repositoryId: string;
  readonly startRef: string;
  readonly endRef: string;
  readonly foundRegression: boolean;
  readonly badCommit?: BisectResult;
  readonly goodCommit?: BisectResult;
  readonly commitsTested: number;
}

const runGit = async (repoPath: string, args: string[]): Promise<string> => {
  let stdout = "";
  try {
    const result = await execFileAsync("git", args, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    stdout = result.stdout ?? "";
    return stdout;
  } catch (err: unknown) {
    const execErr = err as {
      code?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    throw new AppError(
      `Git command failed: ${execErr.message || execErr.stderr || execErr.stdout}`,
      "TOOL_ERROR",
      500,
    );
  }
};

export async function runBisect(
  repo: Repository,
  startRef: string,
  endRef: string,
  testCommand: string,
): Promise<BisectResult> {
  try {
    await runGit(repo.localPath, ["bisect", "reset"]);
  } catch {}

  try {
    await runGit(repo.localPath, ["bisect", "start"]);
    await runGit(repo.localPath, ["bisect", "bad", endRef]);
    await runGit(repo.localPath, ["bisect", "good", startRef]);
    await runGit(repo.localPath, ["bisect", "start", "--", testCommand]);

    let bisectResult = await runGit(repo.localPath, ["bisect", "result"]);

    if (!bisectResult.includes("first bad commit")) {
      await runGit(repo.localPath, ["bisect", "reset"]);
      return {
        commit: "",
        shortHash: "",
        message: "No regression found",
        author: "",
        date: "",
        isBad: false,
        isGood: true,
      };
    }

    await runGit(repo.localPath, ["bisect", "reset"]);

    bisectResult = await runGit(repo.localPath, [
      "bisect",
      "visualize",
      "--oneline",
    ]);
    const lines = bisectResult.trim().split("\n").filter(Boolean);
    if (lines.length === 0) {
      throw new AppError(
        "Bisect completed but no result available",
        "INTERNAL_ERROR",
        500,
      );
    }

    const firstLine = lines[0] || "";
    const parts = firstLine.match(/([a-f0-9]{7,40})\s+(.*)/);
    if (!parts || !parts[1]) {
      throw new AppError(
        "Failed to parse bisect result",
        "INTERNAL_ERROR",
        500,
      );
    }

    const shortHash = parts[1].substring(0, 7);
    const logOutput = await runGit(repo.localPath, [
      "show",
      "--format=%H|%an|%ai|%s",
      "-s",
      parts[1],
    ]);
    const logParts = logOutput.trim().split("|");

    return {
      commit: logParts[0] ?? shortHash,
      shortHash,
      message: (parts[2] || logParts[3]) ?? "",
      author: logParts[1] ?? "",
      date: logParts[2] ?? "",
      isBad: true,
      isGood: false,
    };
  } catch (err) {
    try {
      await runGit(repo.localPath, ["bisect", "reset"]);
    } catch {}
    throw err;
  }
}

export async function detectRegression(
  repo: Repository,
  startRef: string,
  endRef: string,
): Promise<RegressionResult> {
  const startLog = await runGit(repo.localPath, [
    "log",
    "--oneline",
    "--format=%H|%an|%ai|%s",
    "-1",
    startRef,
  ]);
  const endLog = await runGit(repo.localPath, [
    "log",
    "--oneline",
    "--format=%H|%an|%ai|%s",
    "-1",
    endRef,
  ]);

  const startParts = startLog.trim().split("|");
  const endParts = endLog.trim().split("|");

  const startCommit: BisectResult = {
    commit: startParts[0] ?? "",
    shortHash: (startParts[0] ?? "").substring(0, 7),
    message: startParts[3] ?? "",
    author: startParts[1] ?? "",
    date: startParts[2] ?? "",
    isBad: false,
    isGood: true,
  };

  const endCommit: BisectResult = {
    commit: endParts[0] ?? "",
    shortHash: (endParts[0] ?? "").substring(0, 7),
    message: endParts[3] ?? "",
    author: endParts[1] ?? "",
    date: endParts[2] ?? "",
    isBad: true,
    isGood: false,
  };

  return {
    repositoryId: repo.id,
    startRef,
    endRef,
    foundRegression: true,
    badCommit: endCommit,
    goodCommit: startCommit,
    commitsTested: 0,
  };
}

export type { BisectResult, RegressionResult };
