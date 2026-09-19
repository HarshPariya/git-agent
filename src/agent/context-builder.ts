import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import {
  executeGitStatus,
  executeGitLog,
  executeGitDiff,
  executeGitBranches,
  getExecutionPath,
} from "../git/engine.js";
import { repositoryIndexer } from "../graph/repository-indexer.js";
import { repositoryStore } from "../repositories/repository-store.js";
import { logger } from "../logging/logger.js";
import type { RepositoryContext } from "../types/repository-context.js";

/** Stringify only strings; fall back to a default for any other runtime value. */
const safeStr = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

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
  readonly repositoryContext?: RepositoryContext;
}

interface ContextBuildRequest {
  readonly repositoryId: string;
  readonly tenantId: string;
  readonly query: string;
  readonly stackTrace?: string | undefined;
  readonly issueText?: string | undefined;
  readonly prText?: string | undefined;
  readonly repositoryContext?: RepositoryContext | undefined;
}

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  ".nyc_output",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".gradle",
  ".idea",
  ".vscode",
]);

const MAX_DIR_DEPTH = 3;
const MAX_FILES_PER_DIR = 40;
const MAX_TOTAL_FILES = 200;

const SENSITIVE_PATTERN =
  /(?:^|[\\/])(?:\.env(?:\..+)?|credentials\.json|service_account.*\.json|id_rsa.*|id_ed25519.*|\.(?:pem|key|pkcs12|pfx|kdbx)|token\.json|auth\.json)$/i;

async function scanFilesystem(rootPath: string): Promise<{
  tree: string;
  files: string[];
  packageJson: Record<string, unknown> | null;
}> {
  if (!rootPath || !syncFs.existsSync(rootPath)) {
    return { tree: "", files: [], packageJson: null };
  }

  const files: string[] = [];
  const treeLines: string[] = [];
  let packageJson: Record<string, unknown> | null = null;

  try {
    const pkgRaw = await fs.readFile(path.join(rootPath, "package.json"), "utf-8");
    packageJson = JSON.parse(pkgRaw) as Record<string, unknown>;
  } catch {
    // No package.json — not a fatal error
  }

  async function scanDir(dir: string, prefix: string, depth: number): Promise<void> {
    if (depth > MAX_DIR_DEPTH || files.length >= MAX_TOTAL_FILES) return;

    let rawEntries: string[];
    try {
      rawEntries = await fs.readdir(dir);
    } catch {
      return;
    }

    const dirs: Array<{ name: string; fullPath: string }> = [];
    const fileNames: string[] = [];

    for (const name of rawEntries) {
      if (name.startsWith(".") && name !== ".env.example") continue;
      if (IGNORED_DIRS.has(name) || SENSITIVE_PATTERN.test(name)) continue;

      const fullPath = path.join(dir, name);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          dirs.push({ name, fullPath });
        } else {
          fileNames.push(name);
        }
      } catch {
        // Skip inaccessible entries
      }
    }

    dirs.sort((a, b) => a.name.localeCompare(b.name));
    fileNames.sort();

    const displayFiles = fileNames.slice(0, MAX_FILES_PER_DIR);
    for (const name of displayFiles) {
      const relPath = path.relative(rootPath, path.join(dir, name));
      files.push(relPath);
      treeLines.push(`${prefix}${name}`);
    }

    if (fileNames.length > MAX_FILES_PER_DIR) {
      treeLines.push(`${prefix}... +${fileNames.length - MAX_FILES_PER_DIR} more files`);
    }

    for (const { name, fullPath } of dirs) {
      treeLines.push(`${prefix}${name}/`);
      await scanDir(fullPath, `${prefix}  `, depth + 1);
    }
  }

  try {
    await scanDir(rootPath, "", 0);
  } catch (err) {
    logger.warn("Filesystem scan failed", { operation: "context-builder", metadata: { rootPath, error: String(err) } });
  }

  return { tree: treeLines.join("\n"), files, packageJson };
}

function queryRelevantFiles(files: string[], query: string): string[] {
  const keywords = query
    .toLowerCase()
    .split(/[^a-z0-9./]+/)
    .filter((w) => w.length > 2);

  if (keywords.length === 0) return files.slice(0, 15);

  const scored = files.map((file) => {
    const f = file.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (f.includes(kw)) score += 10;
    }
    if (f.match(/\.(test|spec|__tests__)\./)) score -= 2;
    if (f.match(/(config|rc|\.d\.ts)$/)) score -= 1;
    if (f.match(/(index|main|app|server|entry)\./)) score += 3;
    return { file, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map((s) => s.file);
}

export class ContextBuilder {
  async build(req: ContextBuildRequest): Promise<DebugContext> {
    const { repositoryId, tenantId, query, repositoryContext } = req;
    let repositoryName = repositoryContext?.displayName || repositoryId;
    let localPath: string | undefined = repositoryContext?.localPath;

    if (!localPath) {
      try {
        const repo = repositoryStore.getRepository(repositoryId, tenantId);
        if (repo) {
          repositoryName = repo.name;
          localPath = repo.localPath;
        } else {
          localPath = getExecutionPath(repositoryId);
        }
      } catch {
        // Repository lookup failure is not critical
      }
    }

    const [gitCtx, codeCtx] = await Promise.all([
      this.buildGitContext(repositoryId, repositoryContext),
      this.buildCodeContext(repositoryId, tenantId, query, localPath, repositoryContext),
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
      ...(repositoryContext && { repositoryContext }),
    };
  }

  private async buildGitContext(repositoryId: string, repositoryContext?: RepositoryContext): Promise<GitContext> {
    if (repositoryContext?.gitSnapshot) {
      const snap = repositoryContext.gitSnapshot;
      return {
        branch: snap.branch || "main",
        ahead: snap.ahead ?? 0,
        behind: snap.behind ?? 0,
        clean: snap.clean ?? true,
        recentCommits: snap.recentCommits || "",
        changedFiles: [...(snap.changedFiles || [])],
        diff: snap.diff || "",
        branches: snap.branches ? [...snap.branches] : [snap.branch || "main"],
      };
    }

    const fallback: GitContext = {
      branch: repositoryContext?.branch || "unknown",
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
        branch: s?.branch ?? repositoryContext?.branch ?? "unknown",
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
    query: string,
    localPath: string | undefined,
    repositoryContext?: RepositoryContext,
  ): Promise<CodeContext> {
    // If client supplied explicit file manifest (e.g. Local browser repository)
    if (repositoryContext?.fileManifest && repositoryContext.fileManifest.length > 0) {
      const manifest = repositoryContext.fileManifest;
      const validFiles = manifest.filter((f) => f.type !== "SECRET" && f.type !== "BINARY").map((f) => f.path);
      const relevantFiles = queryRelevantFiles(validFiles, query);
      const summary = repositoryContext.manifestSummary;
      const summaryText = summary
        ? `MANIFEST: ${summary.totalFiles} files (${summary.sourceFiles} source, ${summary.testFiles} test, ${summary.configFiles} config, ${summary.docFiles} doc)`
        : `Total files indexed: ${validFiles.length}`;

      const codeSnippets: string[] = [];
      const discoveredSymbols: string[] = [];

      if (repositoryContext.fileContents && typeof repositoryContext.fileContents === "object") {
        for (const [filePath, content] of Object.entries(repositoryContext.fileContents)) {
          const truncated =
            content.length > 15000
              ? `${content.slice(0, 15000)}\n// ... [truncated ${content.length - 15000} bytes]`
              : content;
          codeSnippets.push(`=== FILE: ${filePath} ===\n${truncated}`);

          const matches = content.matchAll(
            /(?:export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var)|function|class)\s+([A-Za-z0-9_$]+)/g,
          );
          for (const m of matches) {
            if (m[1] && !discoveredSymbols.includes(m[1])) {
              discoveredSymbols.push(m[1]);
            }
          }
        }
      }

      return {
        symbols: discoveredSymbols.slice(0, 30),
        graphNodes: validFiles.length,
        graphEdges: 0,
        relevantFiles,
        searchResults: [
          `REPOSITORY CONTEXT: ${repositoryContext.displayName} (${repositoryContext.mode})`,
          summaryText,
          "",
          "=== RELEVANT WORKSPACE FILES ===",
          relevantFiles.join("\n") || validFiles.slice(0, 15).join("\n"),
          ...(codeSnippets.length > 0 ? ["", "=== EXAMINED SOURCE CODE FILES ===", codeSnippets.join("\n\n")] : []),
        ].join("\n"),
      };
    }

    try {
      const graph = await repositoryIndexer.getGraph(repositoryId, tenantId);
      if (graph.nodes.length > 0) {
        return {
          symbols: graph.symbols.slice(0, 20).map((s) => (typeof s.name === "string" ? s.name : "")),
          graphNodes: graph.nodes.length,
          graphEdges: graph.edges.length,
          relevantFiles: [...new Set(graph.nodes.slice(0, 10).map((n) => n.filePath || n.name))],
          searchResults: `Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.symbols.length} symbols`,
        };
      }
    } catch {
      // GraphRAG unavailable — fall through to verified filesystem scan
    }

    if (!localPath || !syncFs.existsSync(localPath)) {
      return {
        symbols: [],
        graphNodes: 0,
        graphEdges: 0,
        relevantFiles: [],
        searchResults: `Repository workspace "${repositoryId}" has no local filesystem path registered.`,
      };
    }

    try {
      const { tree, files, packageJson } = await scanFilesystem(localPath);
      const relevantFiles = queryRelevantFiles(files, query);

      // Prioritize files: query matches first, then top key source files
      const priorityFiles = [...relevantFiles];
      const sourceFileRegex = /\.(ts|js|tsx|jsx|py|go|rs|json)$/i;
      for (const f of files) {
        if (priorityFiles.length >= 15) break;
        if (!priorityFiles.includes(f) && sourceFileRegex.test(f) && !f.includes(".test.") && !f.includes(".spec.")) {
          priorityFiles.push(f);
        }
      }

      // Read real source file contents from disk
      const codeSnippets: string[] = [];
      const discoveredSymbols: string[] = [];
      for (const relFile of priorityFiles) {
        const fullPath = path.join(localPath, relFile);
        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const truncated =
            content.length > 12000
              ? `${content.slice(0, 12000)}\n// ... [truncated ${content.length - 12000} bytes]`
              : content;
          codeSnippets.push(`=== FILE: ${relFile} ===\n${truncated}`);

          const matches = content.matchAll(
            /(?:export\s+(?:default\s+)?(?:class|function|interface|type|const|let|var)|function|class)\s+([A-Za-z0-9_$]+)/g,
          );
          for (const m of matches) {
            if (m[1] && !discoveredSymbols.includes(m[1])) {
              discoveredSymbols.push(m[1]);
            }
          }
        } catch {
          // File read error - skip
        }
      }

      const pkgSummary = packageJson
        ? [
            `name: ${safeStr(packageJson["name"], "unknown")}`,
            `version: ${safeStr(packageJson["version"], "unknown")}`,
            `description: ${safeStr(packageJson["description"], "none")}`,
            `dependencies: ${Object.keys((packageJson["dependencies"] as Record<string, unknown>) ?? {}).join(", ") || "none"}`,
            `devDependencies: ${Object.keys((packageJson["devDependencies"] as Record<string, unknown>) ?? {}).join(", ") || "none"}`,
            `scripts: ${Object.keys((packageJson["scripts"] as Record<string, unknown>) ?? {}).join(", ") || "none"}`,
          ].join("\n")
        : "No package.json found.";

      const searchResults = [
        `FILESYSTEM SCAN (Real source files read & analyzed from workspace):`,
        `Total files in workspace: ${files.length}`,
        `Source files inspected: ${codeSnippets.length}`,
        "",
        "=== DIRECTORY TREE ===",
        tree.slice(0, 2000),
        "",
        "=== PACKAGE INFO ===",
        pkgSummary,
        "",
        `=== RELEVANT FILES (matched query: "${query.slice(0, 60)}") ===`,
        relevantFiles.length > 0 ? relevantFiles.join("\n") : files.slice(0, 15).join("\n"),
        "",
        "=== EXAMINED SOURCE CODE FILES ===",
        codeSnippets.join("\n\n"),
      ].join("\n");

      return {
        symbols: discoveredSymbols.slice(0, 30),
        graphNodes: files.length,
        graphEdges: 0,
        relevantFiles: priorityFiles,
        searchResults,
      };
    } catch (err) {
      return {
        symbols: [],
        graphNodes: 0,
        graphEdges: 0,
        relevantFiles: [],
        searchResults: `Filesystem scan failed: ${String(err)}`,
      };
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
      { condition: !!ctx.code.searchResults, header: "CODE GRAPH", content: ctx.code.searchResults, limit: 4000 },
    ];

    for (const { condition, header, content, limit } of optionalSections) {
      if (condition) {
        sections.push("", `=== ${header} ===`, content.slice(0, limit));
      }
    }

    if (ctx.code.symbols.length > 0) {
      sections.push("", "=== KEY SYMBOLS ===", ctx.code.symbols.join(", "));
    }

    if (ctx.code.relevantFiles.length > 0) {
      sections.push("", "=== RELEVANT FILES ===", ctx.code.relevantFiles.join("\n"));
    }

    return sections.join("\n");
  }
}

export const contextBuilder = new ContextBuilder();

export async function buildDebugContext(
  repositoryId: string,
  query: string,
  options: {
    tenantId?: string | undefined;
    stackTrace?: string | undefined;
    issueText?: string | undefined;
    prText?: string | undefined;
    repositoryContext?: RepositoryContext | undefined;
  } = {},
): Promise<DebugContext> {
  return contextBuilder.build({
    repositoryId,
    tenantId: options.tenantId ?? "default",
    query,
    ...(options.stackTrace !== undefined && { stackTrace: options.stackTrace }),
    ...(options.issueText !== undefined && { issueText: options.issueText }),
    ...(options.prText !== undefined && { prText: options.prText }),
    ...(options.repositoryContext !== undefined && { repositoryContext: options.repositoryContext }),
  });
}

export function formatContextForPrompt(ctx: DebugContext): string {
  return contextBuilder.toPrompt(ctx);
}
