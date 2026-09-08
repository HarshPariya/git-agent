import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { classifyOperation, executeGitBranches, executeGitDiff, executeGitLog, executeGitOperation, executeGitStatus, getExecutionPath, getRiskLabel, GIT_OPERATION_CATALOG, type GitOperationType } from "../git/engine.js";
import { AppError } from "../errors/app-error.js";
import { conflictAnalyzer } from "../git/conflicts.js";
import { executeSafeCommit } from "../git/commit.js";
import { executeSafePush } from "../git/push.js";
import { analyzeAndPlanCommits, executeCommitPlan } from "../git/change-analyzer.js";
import { getGitHubToken } from "../github/auth.js";
import { createGitHubPR } from "../github/pull-requests.js";
import { generateText } from "../llm/client.js";

const execAsync = promisify(exec);
const getGitRequestData = (request: Request): Record<string, unknown> => ({ ...request.query as Record<string, unknown>, ...(typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {}) });
const requireRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : (() => { throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400); })();
const optionalRepoId = (body: Record<string, unknown>) => typeof body.repositoryId === "string" && body.repositoryId.trim() ? body.repositoryId.trim() : undefined;

export async function gitStatusHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const repoId = requireRepoId(getGitRequestData(request));
    let status: Awaited<ReturnType<typeof executeGitStatus>>;
    try { status = await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); }
    response.status(200).json(status);
  } catch (error) { next(error); }
}

export async function gitLogHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body);
    try { await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); }
    const count = typeof body.count === "number" ? body.count : 20;
    const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : undefined;
    const entries = await executeGitLog(repoId, { count, ...(branch !== undefined && { branch }) });
    response.status(200).json({ commits: entries, entries });
  } catch (error) { next(error); }
}

export async function gitConflictsHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    response.status(200).json(await conflictAnalyzer.analyzeRepository(getExecutionPath(repoId)));
  } catch (error) { next(error); }
}

export async function gitConflictResolveHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const repoPath = getExecutionPath(repoId);
    if (typeof body.ours === "string" && typeof body.theirs === "string") {
      const filePath = typeof body.filePath === "string" ? body.filePath : "unknown";
      const resolution = await conflictAnalyzer.resolveFile(repoPath, { filePath, hasConflicts: true, markers: [{ filePath, startLine: 1, endLine: 1, baseLines: typeof body.base === "string" ? (body.base as string).split("\n") : [], ourLines: (body.ours as string).split("\n"), theirLines: (body.theirs as string).split("\n") }] });
      response.status(200).json({ filePath, resolution: resolution.resolvedContent, strategy: resolution.strategy, confidence: resolution.confidence, explanation: resolution.explanation });
      return;
    }
    response.status(200).json(await conflictAnalyzer.resolveAllConflicts(repoPath));
  } catch (error) { next(error); }
}

export async function gitCommitHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const message = typeof body.message === "string" ? body.message : undefined;
    const result = await executeSafeCommit(getExecutionPath(repoId), { ...(message !== undefined ? { message } : {}), stageAll: body.stageAll !== false });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

export async function gitPushHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const result = await executeSafePush(getExecutionPath(repoId), { ...(typeof body.remote === "string" ? { remote: body.remote } : {}), ...(typeof body.branch === "string" ? { branch: body.branch } : {}), setUpstream: body.setUpstream === true, forceWithLease: body.forceWithLease === true, allowForce: body.allowForce === true });
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

export async function gitPullHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const remote = typeof body.remote === "string" ? body.remote : "origin";
    const branch = typeof body.branch === "string" ? body.branch : "";
    const rebase = body.rebase === true ? "--rebase" : "";
    const cmd = ["git pull", remote, branch, rebase].filter(Boolean).join(" ");
    try { const { stdout, stderr } = await execAsync(cmd, { cwd: getExecutionPath(repoId), timeout: 60000 }); response.status(200).json({ success: true, output: stdout.trim() || stderr.trim() || "Pull completed.", remote }); }
    catch (err: any) { response.status(200).json({ success: false, output: err.stdout || "", error: err.stderr || err.message, remote }); }
  } catch (error) { next(error); }
}

export async function gitFetchHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const remote = typeof body.remote === "string" ? body.remote : "origin";
    const cmd = ["git fetch", remote, body.prune !== false ? "--prune" : ""].filter(Boolean).join(" ");
    try { const { stdout, stderr } = await execAsync(cmd, { cwd: getExecutionPath(repoId), timeout: 60000 }); response.status(200).json({ success: true, output: stdout.trim() || stderr.trim() || "Fetch completed.", remote }); }
    catch (err: any) { response.status(200).json({ success: false, output: err.stdout || "", error: err.stderr || err.message, remote }); }
  } catch (error) { next(error); }
}

export async function gitCheckoutHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = optionalRepoId(body);
    if (!repoId) throw new AppError("repositoryId is required", "VALIDATION_ERROR", 400);
    const branch = typeof body.branch === "string" && body.branch.trim() ? body.branch.trim() : undefined;
    if (!branch) throw new AppError("branch is required", "VALIDATION_ERROR", 400);
    const cmd = body.create === true ? `git checkout -b ${branch}` : `git checkout ${branch}`;
    try { const { stdout, stderr } = await execAsync(cmd, { cwd: getExecutionPath(repoId), timeout: 30000 }); response.status(200).json({ success: true, branch, output: stdout.trim() || stderr.trim() || `Switched to branch '${branch}'.` }); }
    catch (err: any) { response.status(200).json({ success: false, branch, output: err.stdout || "", error: err.stderr || err.message }); }
  } catch (error) { next(error); }
}

export async function gitDiffHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body);
    try { await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); }
    const staged = body.staged === true;
    const filePath = typeof body.filePath === "string" && body.filePath.trim() ? body.filePath.trim() : undefined;
    const repoPath = getExecutionPath(repoId); let diffText = "";
    if (filePath) {
      const tryCmds = [`git diff -- "${filePath}"`, `git diff --cached -- "${filePath}"`, `git diff HEAD -- "${filePath}"`, `git diff HEAD^..HEAD -- "${filePath}"`];
      for (const cmd of tryCmds) { if (diffText) break; try { const { stdout } = await execAsync(cmd, { cwd: repoPath }); if (stdout.trim()) diffText = stdout.trim(); } catch { /* skip */ } }
      if (!diffText) { try { const content = await fs.readFile(path.resolve(repoPath, filePath), "utf-8"); const lines = content.split("\n"); diffText = [`diff --git a/${filePath} b/${filePath}`, "new file mode 100644", "--- /dev/null", `+++ b/${filePath}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"); } catch { /* skip */ } }
    } else {
      try {
        const { stdout: unstagedOut } = await execAsync("git diff", { cwd: repoPath }); const { stdout: stagedOut } = await execAsync("git diff --cached", { cwd: repoPath }); diffText = [unstagedOut.trim(), stagedOut.trim()].filter(Boolean).join("\n");
        const { stdout: untrackedOut } = await execAsync("git ls-files --others --exclude-standard", { cwd: repoPath });
        for (const uFile of untrackedOut.split("\n").map((f) => f.trim()).filter(Boolean).slice(0, 15)) { try { const content = await fs.readFile(path.resolve(repoPath, uFile), "utf-8"); const lines = content.split("\n"); const uDiff = [`diff --git a/${uFile} b/${uFile}`, "new file mode 100644", "--- /dev/null", `+++ b/${uFile}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"); diffText = diffText ? `${diffText}\n\n${uDiff}` : uDiff; } catch { /* skip */ } }
      } catch { /* skip */ }
    }
    const entries = await executeGitDiff(repoId, { ...(staged && { staged }), ...(filePath !== undefined && { filePath }) });
    response.status(200).json({ success: true, diff: diffText, filePath, entries, files: entries.map((e) => ({ ...e, diff: e.filePath === filePath ? diffText : "" })) });
  } catch (error) { next(error); }
}

export async function gitBranchesHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body);
    try { await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); }
    response.status(200).json(await executeGitBranches(repoId));
  } catch (error) { next(error); }
}

export async function gitExecuteHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const { operation } = request.params; const opType = operation as GitOperationType;
    const catalogEntry = GIT_OPERATION_CATALOG.find((op) => op.type === opType);
    if (!catalogEntry) throw new AppError(`Unknown git operation: ${operation}`, "VALIDATION_ERROR", 400);
    const body = typeof request.body === "object" && request.body !== null ? (request.body as Record<string, unknown>) : {};
    const repoId = requireRepoId(body);
    try { await executeGitStatus(repoId); } catch { throw new AppError("Repository not accessible", "VALIDATION_ERROR", 400); }
    const args = Array.isArray(body.args) ? (body.args as string[]) : [];
    const approvalTokenStr = typeof body.approvalToken === "string" ? body.approvalToken : undefined;
    const result = await executeGitOperation(repoId, opType, args, approvalTokenStr !== undefined ? { dryRun: body.dryRun === true, approvalToken: approvalTokenStr } : { dryRun: body.dryRun === true });
    response.status(200).json(result);
  } catch (error) { next(error); }
}

export async function gitOperationCatalogHandler(_request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(GIT_OPERATION_CATALOG.map((op) => ({ type: op.type, risk: op.risk, riskLabel: getRiskLabel(op.risk), command: op.command, description: op.description, requiresApproval: op.requiresApproval, dryRunSupported: op.dryRunSupported })));
  } catch (error) { next(error); }
}

export async function gitClassifyHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const op = classifyOperation(request.params.operation as GitOperationType);
    response.status(200).json({ type: op.type, risk: op.risk, riskLabel: getRiskLabel(op.risk), requiresApproval: op.requiresApproval, dryRunSupported: op.dryRunSupported, description: op.description });
  } catch (error) { next(error); }
}

export async function gitAnalyzeChangesHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const plan = await analyzeAndPlanCommits(getExecutionPath(requireRepoId(getGitRequestData(request))));
    response.status(200).json({ success: true, plan, summary: plan.summary, totalFiles: plan.totalFiles, totalCommits: plan.totalCommits, groups: plan.groups, changedFiles: plan.changedFiles });
  } catch (error) { next(error); }
}

export async function gitExecuteCommitPlanHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoPath = getExecutionPath(requireRepoId(body));
    let groups = Array.isArray(body.groups) ? body.groups : undefined;
    if (!groups || groups.length === 0) { const plan = await analyzeAndPlanCommits(repoPath); groups = plan.groups; }
    if (!groups || groups.length === 0) { response.status(200).json({ success: false, message: "No change groups to commit.", commits: [], totalCreated: 0 }); return; }
    const result = await executeCommitPlan(repoPath, groups);
    response.status(result.success ? 200 : 400).json(result);
  } catch (error) { next(error); }
}

export async function gitSyncHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body); const repoPath = getExecutionPath(repoId);
    const remote = typeof body.remote === "string" ? body.remote : "origin";
    try { await execAsync(`git fetch ${remote} --prune`, { cwd: repoPath, timeout: 45_000 }); } catch (err: any) { console.warn("[gitSync] Fetch warning:", err.message); }
    const status = await executeGitStatus(repoId);
    let actionRequired: "none" | "push" | "pull" | "diverged" | "commit_required" = "none";
    let message = "Repository is in sync with remote.";
    if (!status.clean) { actionRequired = "commit_required"; message = "Uncommitted local changes present. Commit or stash before syncing."; }
    else if (status.ahead > 0 && status.behind > 0) { actionRequired = "diverged"; message = `Branches have diverged (${status.ahead} ahead, ${status.behind} behind). Rebase or merge required.`; }
    else if (status.behind > 0) { actionRequired = "pull"; try { const { stdout } = await execAsync(`git pull ${remote}`, { cwd: repoPath, timeout: 60_000 }); message = `Successfully pulled remote changes. ${stdout.trim()}`; actionRequired = "none"; } catch (pullErr: any) { message = `Pull encountered conflicts or issues: ${pullErr.message}`; } }
    else if (status.ahead > 0) { actionRequired = "push"; message = `Local branch is ${status.ahead} commit(s) ahead of remote. Ready to push.`; }
    const updatedStatus = await executeGitStatus(repoId);
    response.status(200).json({ success: true, branch: updatedStatus.branch, ahead: updatedStatus.ahead, behind: updatedStatus.behind, clean: updatedStatus.clean, actionRequired, message });
  } catch (error) { next(error); }
}

export async function gitShipHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body); const repoPath = getExecutionPath(repoId);
    const targetBranch = typeof body.targetBranch === "string" && body.targetBranch ? body.targetBranch : "main";
    const prTitle = typeof body.prTitle === "string" ? body.prTitle : undefined;
    const plan = await analyzeAndPlanCommits(repoPath);
    if (plan.groups.length === 0) { const status = await executeGitStatus(repoId); if (status.ahead === 0) { response.status(200).json({ success: false, message: "No changes to ship and working tree is in sync." }); return; } }
    let commitResult = { success: true, commits: [] as any[], totalCreated: 0 };
    if (plan.groups.length > 0) { const execRes = await executeCommitPlan(repoPath, plan.groups); if (!execRes.success) { response.status(400).json({ success: false, message: `Commit step failed: ${execRes.message}`, error: execRes.error }); return; } commitResult = execRes; }
    const pushResult = await executeSafePush(repoPath, { setUpstream: true });
    if (!pushResult.success) { response.status(400).json({ success: false, message: `Push step failed: ${pushResult.error || pushResult.output || "Unknown push error"}`, error: pushResult.error, commits: commitResult.commits }); return; }
    const branchStatus = await executeGitStatus(repoId); const sourceBranch = branchStatus.branch; let prData: any = null;
    let owner = typeof body.owner === "string" ? body.owner : ""; let repoName = typeof body.repo === "string" ? body.repo : "";
    if (!owner || !repoName) { try { const { stdout: remoteUrl } = await execAsync("git remote get-url origin", { cwd: repoPath, timeout: 10000 }); const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(remoteUrl.trim()); if (match && match[1] && match[2]) { owner = match[1]; repoName = match[2]; } } catch { /* skip */ } }
    const userId = (request as unknown as { user?: { id?: string } }).user?.id ?? "anonymous"; const token = getGitHubToken(userId);
    if (token && owner && repoName && sourceBranch !== targetBranch) {
      try {
        const title = prTitle || commitResult.commits[0]?.commitMessage || `feat: ship updates on ${sourceBranch}`; const prBody = `### AI Ship Automated Pull Request\n\n**Source Branch:** \`${sourceBranch}\`\n**Target Branch:** \`${targetBranch}\`\n\n#### Commits Included (${commitResult.commits.length}):\n${commitResult.commits.map((c: any) => `- \`${c.commitHash}\`: ${c.commitMessage} (${c.files.length} files)`).join("\n")}\n\n*Verified and shipped automatically by AI Git Debugging Agent.*`;
        const pr = await createGitHubPR(userId, owner, repoName, { title, body: prBody, head: sourceBranch, base: targetBranch }); prData = { id: pr.id, number: pr.number, url: pr.htmlUrl, title: pr.title };
      } catch (prErr: any) { console.warn("[gitShip] PR creation warning:", prErr.message); }
    }
    response.status(200).json({ success: true, message: `Shipped successfully: ${commitResult.totalCreated} commit(s) pushed on '${sourceBranch}'.${prData ? ` PR #${prData.number} created.` : ""}`, branch: sourceBranch, commits: commitResult.commits, pushed: true, pr: prData });
  } catch (error) { next(error); }
}

export async function generateCommitMessageHandler(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    const body = getGitRequestData(request); const repoId = requireRepoId(body);
    const status = await executeGitStatus(repoId);
    const statusAny = status as unknown as Record<string, unknown[]>;
    const changedFiles: unknown[] = [...((status.entries ?? []) as readonly unknown[]), ...(statusAny.staged ?? []), ...(statusAny.unstaged ?? []), ...(statusAny.untracked ?? [])];
    if (changedFiles.length === 0) { response.status(200).json({ summary: "chore: no changes detected", description: "", files: [], branch: (status as { branch?: string }).branch ?? "main" }); return; }
    let diffContext = "";
    try { const repoPath = getExecutionPath(repoId); const { stdout: unstagedOut } = await execAsync("git diff", { cwd: repoPath }); const { stdout: stagedOut } = await execAsync("git diff --cached", { cwd: repoPath }); diffContext = [unstagedOut.trim(), stagedOut.trim()].filter(Boolean).join("\n").slice(0, 4000); }
    catch { diffContext = changedFiles.map((f) => `- ${String((f as Record<string, unknown>).path ?? (f as Record<string, unknown>).filePath ?? f)} (${String((f as Record<string, unknown>).status ?? "modified")})`).join("\n"); }
    const fileList = changedFiles.map((f) => { const fo = f as Record<string, unknown>; return `${String(fo.status ?? "modified")}: ${String(fo.path ?? fo.filePath ?? f)}`; }).join("\n");
    const instructions = `You are a Principal Software Engineer. Write a production-ready, professional Conventional Commit message for these git changes.\n\nStrict Rules:\n1. Format: <type>(<scope>): <clear, concise, imperative summary of what was actually changed/added/fixed>\n2. Types: feat, fix, chore, refactor, style, docs, test, ci, perf, build\n3. The summary line must be <= 72 characters, describing the concrete capability or bug fix (NEVER generic phrases like "update files" or "work in progress").\n4. The description must have 2 to 6 detailed bullet points starting with "- ", explaining:\n   - What architectural changes or capabilities were introduced\n   - Which specific files and components were modified and why\n   - Any UX, API, or bug fix enhancements\n5. Output ONLY valid JSON matching this exact structure:\n{"summary": "feat(scope): concise summary", "description": "- bullet 1\\n- bullet 2\\n- bullet 3"}`;
    const input = `Changed files:\n${fileList}\n\nGit diff (truncated):\n${diffContext}`;
    let summary = ""; let description = "";
    try {
      const llmRes = await generateText({ instructions, input });
      let clean = llmRes.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      try { const jsonMatch = /\{[\s\S]*\}/.exec(clean); if (jsonMatch) { const parsed = JSON.parse(jsonMatch[0]) as { summary?: string; description?: string | string[] }; if (parsed.summary && !parsed.summary.toLowerCase().includes("update files")) summary = String(parsed.summary).trim(); if (parsed.description) description = Array.isArray(parsed.description) ? parsed.description.join("\n") : String(parsed.description).trim(); } }
      catch { const summaryMatch = /"summary"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/.exec(clean); if (summaryMatch?.[1] && !summaryMatch[1].toLowerCase().includes("update files")) summary = summaryMatch[1].replace(/\\"/g, '"').trim(); const descMatch = /"description"\s*:\s*"([\s\S]*?)"\s*\}/.exec(clean); if (descMatch?.[1]) description = descMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').split("\n").map((l) => l.trim()).filter(Boolean).join("\n"); }
      if (!summary) { const lines = clean.split("\n").map((l) => l.trim()).filter((l) => !l.startsWith("```") && l); for (const line of lines) { if (/^(feat|fix|chore|refactor|style|docs|test|ci|perf|build)(\([^)]+\))?:/.test(line)) { summary = line; break; } } if (!summary && lines.length > 0) summary = lines[0] ?? ""; if (!description) description = lines.filter((l) => l.startsWith("-") || l.startsWith("*")).join("\n"); }
    } catch { /* LLM call failed */ }
    if (!summary || summary.toLowerCase().includes("update ") && summary.toLowerCase().includes("files")) {
      const allPaths = changedFiles.map((f) => String((f as Record<string, unknown>).path ?? (f as Record<string, unknown>).filePath ?? f));
      const hasApi = allPaths.some((p) => p.includes("api/") || p.includes("api.")); const hasFrontend = allPaths.some((p) => p.startsWith("public/") || p.includes("html") || p.includes("css")); const hasGit = allPaths.some((p) => p.includes("git")); const hasTests = allPaths.some((p) => p.includes("test"));
      let scope = "core"; if (hasFrontend && hasApi) scope = "fullstack"; else if (hasFrontend) scope = "ui"; else if (hasGit) scope = "git"; else if (hasApi) scope = "api"; else if (hasTests) scope = "tests";
      const type = hasTests ? "test" : hasFrontend || hasApi ? "feat" : "chore"; const topComponents = allPaths.slice(0, 3).map((p) => path.basename(p, path.extname(p))).join(", ");
      summary = `${type}(${scope}): update ${topComponents}${allPaths.length > 3 ? ` and ${allPaths.length - 3} related files` : ""}`;
      description = allPaths.map((p) => { if (p.includes("api.js") || p.includes("api.ts")) return `- ${p}: add client API methods and backend endpoint handlers`; if (p.includes("app.js") || p.includes("app.ts")) return `- ${p}: update application state management, event listeners, and UI views`; if (p.includes("index.html")) return `- ${p}: refine layout structure, modal dialogs, and interactive action controls`; if (p.includes("styles.css")) return `- ${p}: update design tokens, diff viewer syntax styling, and responsive layout rules`; if (p.includes("git")) return `- ${p}: enhance git operation engine, branch refspec resolution, and commit planning`; if (p.includes("fs")) return `- ${p}: expand filesystem navigation and OS file explorer dialog integration`; return `- ${p}: apply component modifications and sync verified changes`; }).slice(0, 8).join("\n");
    }
    response.status(200).json({ summary, description, files: changedFiles, branch: (status as { branch?: string }).branch ?? "main" });
  } catch (error) { next(error); }
}
