import type { Repository } from "../types/git.js";
import { AppError } from "../errors/app-error.js";
import { execAsync } from "./utils.js";

export interface BisectResult {
  readonly commit: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
  readonly isBad: boolean;
  readonly isGood: boolean;
}

export interface RegressionResult {
  readonly repositoryId: string;
  readonly startRef: string;
  readonly endRef: string;
  readonly foundRegression: boolean;
  readonly badCommit: BisectResult | undefined;
  readonly goodCommit?: BisectResult;
  readonly commitsTested: number;
}

const NO_REGRESSION: BisectResult = {
  commit: "",
  shortHash: "",
  message: "No regression found",
  author: "",
  date: "",
  isBad: false,
  isGood: true,
};

async function runGit(repoPath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args.join(" ")}`, {
      cwd: repoPath,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout ?? "";
  } catch (err: unknown) {
    const e = err as { message?: string; stderr?: string; stdout?: string };
    throw new AppError(
      `Git command failed: ${e.message ?? e.stderr ?? e.stdout ?? "unknown error"}`,
      "TOOL_ERROR",
      500,
    );
  }
}

const parseLogLine = (logOutput: string): BisectResult => {
  const [commit, author, date, ...rest] = logOutput.trim().split("|");
  const shortHash = commit?.substring(0, 7) ?? "";
  return {
    commit: commit ?? shortHash,
    shortHash,
    author: author ?? "",
    date: date ?? "",
    message: rest.join("|"),
    isBad: true,
    isGood: false,
  };
};

export async function runBisect(
  repo: Repository,
  startRef: string,
  endRef: string,
  testCommand: string,
): Promise<BisectResult> {
  const reset = () => runGit(repo.localPath, ["bisect", "reset"]).catch(() => {});
  await reset();

  try {
    await runGit(repo.localPath, ["bisect", "start"]);
    await runGit(repo.localPath, ["bisect", "bad", endRef]);
    await runGit(repo.localPath, ["bisect", "good", startRef]);
    await runGit(repo.localPath, ["bisect", "start", "--", testCommand]);

    const result = await runGit(repo.localPath, ["bisect", "result"]);
    if (!result.includes("first bad commit")) return NO_REGRESSION;

    await runGit(repo.localPath, ["bisect", "reset"]);
    const visualize = await runGit(repo.localPath, ["bisect", "visualize", "--oneline"]);
    const firstLine = visualize.trim().split("\n").filter(Boolean)[0] ?? "";
    const match = firstLine.match(/([a-f0-9]{7,40})\s+(.*)/);
    if (!match?.[1]) throw new AppError("Failed to parse bisect result", "INTERNAL_ERROR", 500);

    const logOutput = await runGit(repo.localPath, ["show", "--format=%H|%an|%ai|%s", "-s", match[1]]);
    const parsed = parseLogLine(logOutput);
    return { ...parsed, shortHash: match[1].substring(0, 7), message: match[2] || parsed.message };
  } catch (err) {
    await reset();
    throw err;
  }
}

export async function detectRegression(
  repo: Repository,
  startRef: string,
  endRef: string,
  testCommand?: string,
): Promise<RegressionResult> {
  const startLog = await runGit(repo.localPath, ["log", "--oneline", "--format=%H|%an|%ai|%s", "-1", startRef]);

  // A regression can only be confirmed by actually testing commits; without a
  // test command this is a metadata gap-lookup, not a detection.
  if (!testCommand) {
    return {
      repositoryId: repo.id,
      startRef,
      endRef,
      foundRegression: false,
      goodCommit: { ...parseLogLine(startLog), isBad: false, isGood: true },
      badCommit: undefined,
      commitsTested: 0,
    };
  }

  const bisect = await runBisect(repo, startRef, endRef, testCommand);
  const foundRegression = !bisect.isGood;

  return {
    repositoryId: repo.id,
    startRef,
    endRef,
    foundRegression,
    badCommit: foundRegression ? bisect : undefined,
    goodCommit: { ...parseLogLine(startLog), isBad: false, isGood: true },
    commitsTested: foundRegression ? 1 : 0,
  };
}
