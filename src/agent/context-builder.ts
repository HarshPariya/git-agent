import {
  executeGitStatus, executeGitLog, executeGitDiff, executeGitBranches,
} from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";
import { repositoryStore } from "../repositories/repository-store.js";

export interface GitContext {
  readonly branch: string; ahead: number; behind: number; clean: boolean;
  readonly recentCommits: string; readonly changedFiles: string[];
  readonly diff: string; readonly branches: string[];
}
export interface CodeContext {
  readonly symbols: string[]; readonly graphNodes: number; readonly graphEdges: number;
  readonly relevantFiles: string[]; readonly searchResults: string;
}
export interface DebugContext {
  readonly repositoryId: string; readonly repositoryName: string;
  readonly localPath: string | undefined; readonly query: string;
  readonly git: GitContext; readonly code: CodeContext;
  readonly stackTrace: string | undefined; readonly issueText: string | undefined;
  readonly prText: string | undefined; readonly builtAt: string;
}
interface ContextBuildRequest {
  readonly repositoryId: string; readonly tenantId: string; readonly query: string;
  readonly stackTrace?: string; readonly issueText?: string; readonly prText?: string;
}

export class ContextBuilder {
  async build(req: ContextBuildRequest): Promise<DebugContext> {
    const { repositoryId, tenantId, query } = req;
    let repositoryName = repositoryId; let localPath: string | undefined;
    try { const repo = repositoryStore.getRepository(repositoryId, tenantId); if (repo) { repositoryName = repo.name; localPath = repo.localPath; } } catch { /* not critical */ }
    const gitCtx = await this.buildGitContext(repositoryId);
    const codeCtx = await this.buildCodeContext(repositoryId, tenantId, query);
    return { repositoryId, repositoryName, localPath, query, git: gitCtx, code: codeCtx, stackTrace: req.stackTrace, issueText: req.issueText, prText: req.prText, builtAt: new Date().toISOString() };
  }

  private async buildGitContext(repositoryId: string): Promise<GitContext> {
    try {
      const [status, log, diff, branches] = await Promise.allSettled([
        executeGitStatus(repositoryId), executeGitLog(repositoryId, { count: 10 }),
        executeGitDiff(repositoryId), executeGitBranches(repositoryId),
      ]);
      const s = status.status === "fulfilled" ? status.value : null;
      const l = log.status === "fulfilled" ? log.value : [];
      const d = diff.status === "fulfilled" ? diff.value : [];
      const b = branches.status === "fulfilled" ? branches.value : [];
      const changedFiles = s?.entries.map((e) => e.filePath) ?? [];
      const branchNames = b.map((br) => `${br.current ? "* " : "  "}${br.name}`);
      const recentCommits = l.map((c) => `${c.shortHash} ${c.author} — ${c.message}`).join("\n");
      const diffText = d.map((f) => `${f.filePath} (+${f.additions} -${f.deletions})`).join("\n");
      return { branch: s?.branch ?? "unknown", ahead: s?.ahead ?? 0, behind: s?.behind ?? 0, clean: s?.clean ?? true, recentCommits, changedFiles, diff: diffText, branches: branchNames };
    } catch { return { branch: "unknown", ahead: 0, behind: 0, clean: true, recentCommits: "", changedFiles: [], diff: "", branches: [] }; }
  }

  private async buildCodeContext(repositoryId: string, tenantId: string, _query: string): Promise<CodeContext> {
    try {
      const graph = await repositoryIndexer.getGraph(repositoryId, tenantId);
      const symbols = graph.symbols.slice(0, 20).map((s) => s.name ?? String(s));
      const relevantFiles = Array.from(new Set(graph.nodes.slice(0, 10).map((n) => n.filePath || n.name)));
      return { symbols, graphNodes: graph.nodes.length, graphEdges: graph.edges.length, relevantFiles, searchResults: `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.symbols.length} symbols` };
    } catch { return { symbols: [], graphNodes: 0, graphEdges: 0, relevantFiles: [], searchResults: "Graph not available — run GraphRAG index first." }; }
  }

  toPrompt(ctx: DebugContext): string {
    const lines = [`REPOSITORY: ${ctx.repositoryName} (${ctx.repositoryId})`, `PATH: ${ctx.localPath ?? "remote"}`, `BRANCH: ${ctx.git.branch} (ahead: ${ctx.git.ahead}, behind: ${ctx.git.behind})`, `WORKING TREE: ${ctx.git.clean ? "clean" : "dirty"}`, "", "=== DEBUGGING REQUEST ===", ctx.query];
    if (ctx.stackTrace) lines.push("", "=== STACK TRACE ===", ctx.stackTrace.slice(0, 2000));
    if (ctx.issueText) lines.push("", "=== ISSUE ===", ctx.issueText.slice(0, 1000));
    if (ctx.prText) lines.push("", "=== PR ===", ctx.prText.slice(0, 1000));
    if (ctx.git.recentCommits) lines.push("", "=== RECENT COMMITS ===", ctx.git.recentCommits.slice(0, 1500));
    if (ctx.git.diff) lines.push("", "=== CHANGED FILES ===", ctx.git.diff.slice(0, 1500));
    if (ctx.code.searchResults) lines.push("", "=== CODE GRAPH ===", ctx.code.searchResults.slice(0, 1000));
    if (ctx.code.symbols.length > 0) lines.push("", "=== KEY SYMBOLS ===", ctx.code.symbols.join(", "));
    return lines.join("\n");
  }
}

export const contextBuilder = new ContextBuilder();

export async function buildDebugContext(repositoryId: string, query: string, options: { tenantId?: string; stackTrace?: string; issueText?: string; prText?: string } = {}): Promise<DebugContext> {
  return contextBuilder.build({ repositoryId, tenantId: options.tenantId ?? "default", query, ...(options.stackTrace !== undefined && { stackTrace: options.stackTrace }), ...(options.issueText !== undefined && { issueText: options.issueText }), ...(options.prText !== undefined && { prText: options.prText }) });
}

export function formatContextForPrompt(ctx: DebugContext): string { return contextBuilder.toPrompt(ctx); }
