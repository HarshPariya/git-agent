import {
  executeGitStatus,
  executeGitLog,
  executeGitDiff,
  executeGitBranches,
} from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";
import { repositoryStore } from "../repositories/repository-store.js";

export interface GitContext {
  readonly branch: string;
  ahead: number;
  behind: number;
  clean: boolean;
  readonly recentCommits: string;
  readonly changedFiles: string[];
  readonly diff: string;
  readonly branches: string[];
}

export interface CodeContext {
  readonly symbols: string[];
  readonly graphNodes: number;
  readonly graphEdges: number;
  readonly relevantFiles: string[];
  readonly searchResults: string;
}

export interface DebugContext {
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly localPath: string | undefined;
  readonly query: string;
  readonly git: GitContext;
  readonly code: CodeContext;
  readonly stackTrace: string | undefined;
  readonly issueText: string | undefined;
  readonly prText: string | undefined;
  readonly builtAt: string;
}

interface ContextBuildRequest {
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly query: string;
  readonly stackTrace?: string;
  readonly issueText?: string;
  readonly prText?: string;
}

export class ContextBuilder {
  async build(req: ContextBuildRequest): Promise<DebugContext> {
    const { repositoryId, tenantId, query } = req;
    let repositoryName = repositoryId;
    let localPath: string | undefined;

    try {
      const repo = repositoryStore.getRepository(repositoryId, tenantId);
      if (repo) {
        repositoryName = repo.name;
        localPath = repo.localPath;
      }
    } catch {
      // Repository lookup failure is not critical
    }

    const [gitCtx, codeCtx] = await Promise.all([
      this.buildGitContext(repositoryId),
      this.buildCodeContext(repositoryId, tenantId, query),
    ]);

    return {
      repositoryId,
      repositoryName,
      localPath,
      query,
      git: gitCtx,
      code: codeCtx,
      stackTrace: req.stackTrace,
      issueText: req.issueText,
      prText: req.prText,
      builtAt: new Date().toISOString(),
    };
  }

  private async buildGitContext(repositoryId: string): Promise<GitContext> {
    const fallback: GitContext = {
      branch: "unknown",
      ahead: 0,
      behind: 0,
      clean: true,
      recentCommits: "",
      changedFiles: [],
      diff: "",
      branches: [],
    };

    try {
      const [status, log, diff, branches] = await Promise.allSettled([
        executeGitStatus(repositoryId),
        executeGitLog(repositoryId, { count: 10 }),
        executeGitDiff(repositoryId),
        executeGitBranches(repositoryId),
      ]);

      const s = status.status === "fulfilled" ? status.value : null;
      const l = log.status === "fulfilled" ? log.value : [];
      const d = diff.status === "fulfilled" ? diff.value : [];
      const b = branches.status === "fulfilled" ? branches.value : [];

      return {
        branch: s?.branch ?? "unknown",
        ahead: s?.ahead ?? 0,
        behind: s?.behind ?? 0,
        clean: s?.clean ?? true,
        recentCommits: l.map((c) => `${c.shortHash} ${c.author} — ${c.message}`).join("\n"),
        changedFiles: s?.entries.map((e) => e.filePath) ?? [],
        diff: d.map((f) => `${f.filePath} (+${f.additions} -${f.deletions})`).join("\n"),
        branches: b.map((br) => `${br.current ? "* " : "  "}${br.name}`),
      };
    } catch {
      return fallback;
    }
  }

  private async buildCodeContext(
    repositoryId: string,
    tenantId: string,
    _query: string
  ): Promise<CodeContext> {
    const fallback: CodeContext = {
      symbols: [],
      graphNodes: 0,
      graphEdges: 0,
      relevantFiles: [],
      searchResults: "Graph not available — run GraphRAG index first.",
    };

    try {
      const graph = await repositoryIndexer.getGraph(repositoryId, tenantId);
      return {
        symbols: graph.symbols.slice(0, 20).map((s) => typeof s.name === "string" ? s.name : ""),
        graphNodes: graph.nodes.length,
        graphEdges: graph.edges.length,
        relevantFiles: [...new Set(graph.nodes.slice(0, 10).map((n) => n.filePath || n.name))],
        searchResults: `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.symbols.length} symbols`,
      };
    } catch {
      return fallback;
    }
  }

  toPrompt(ctx: DebugContext): string {
    const sections: string[] = [
      `REPOSITORY: ${ctx.repositoryName} (${ctx.repositoryId})`,
      `PATH: ${ctx.localPath ?? "remote"}`,
      `BRANCH: ${ctx.git.branch} (ahead: ${ctx.git.ahead}, behind: ${ctx.git.behind})`,
      `WORKING TREE: ${ctx.git.clean ? "clean" : "dirty"}`,
      "",
      "=== DEBUGGING REQUEST ===",
      ctx.query,
    ];

    const optionalSections: Array<{ condition: boolean; header: string; content: string; limit: number }> = [
      { condition: !!ctx.stackTrace, header: "STACK TRACE", content: ctx.stackTrace ?? "", limit: 2000 },
      { condition: !!ctx.issueText, header: "ISSUE", content: ctx.issueText ?? "", limit: 1000 },
      { condition: !!ctx.prText, header: "PR", content: ctx.prText ?? "", limit: 1000 },
      { condition: !!ctx.git.recentCommits, header: "RECENT COMMITS", content: ctx.git.recentCommits, limit: 1500 },
      { condition: !!ctx.git.diff, header: "CHANGED FILES", content: ctx.git.diff, limit: 1500 },
      { condition: !!ctx.code.searchResults, header: "CODE GRAPH", content: ctx.code.searchResults, limit: 1000 },
    ];

    for (const { condition, header, content, limit } of optionalSections) {
      if (condition) {
        sections.push("", `=== ${header} ===`, content.slice(0, limit));
      }
    }

    if (ctx.code.symbols.length > 0) {
      sections.push("", "=== KEY SYMBOLS ===", ctx.code.symbols.join(", "));
    }

    return sections.join("\n");
  }
}

export const contextBuilder = new ContextBuilder();

export async function buildDebugContext(
  repositoryId: string,
  query: string,
  options: { tenantId?: string; stackTrace?: string; issueText?: string; prText?: string } = {}
): Promise<DebugContext> {
  return contextBuilder.build({
    repositoryId,
    tenantId: options.tenantId ?? "default",
    query,
    ...(options.stackTrace !== undefined && { stackTrace: options.stackTrace }),
    ...(options.issueText !== undefined && { issueText: options.issueText }),
    ...(options.prText !== undefined && { prText: options.prText }),
  });
}

export function formatContextForPrompt(ctx: DebugContext): string {
  return contextBuilder.toPrompt(ctx);
}
