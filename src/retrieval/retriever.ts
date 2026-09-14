import path from "node:path";
import { existsSync } from "node:fs";
import { parseRepository, type ParsedFile } from "../ingestion/parser.js";
import { chunkRepository, type CodeChunk } from "../ingestion/chunker.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, type CodeGraph } from "../graph/graph-builder.js";
import { computeRepositoryHash, loadGraphCache, saveGraphCache } from "../graph/graph-cache.js";
import { pgVectorSearch, upsertChunks, type VectorSearchFilterOptions } from "../db/vector-store.js";
import type { VectorSearchResult } from "./vector-search.js";
import { hybridSearch, type HybridSearchOptions } from "./hybrid-search.js";
import { rerankResults, type RerankedResult } from "./reranker.js";
import { validateQueryLength, validateTopK, validateRepositoryScan } from "../guardrails/retrieval-limits.js";
import { metricsCollector } from "../monitoring/observability.js";
import { toRepositoryPath } from "./repository-path.js";
import { updateRetrievalRuntimeStatus } from "./runtime-status.js";
import { findAstSymbolReferences } from "./ast-reference-search.js";
import type { SymbolReferenceReport } from "./types.js";

export interface RetrieverOptions {
  limit?: number;
  vectorWeight?: number;
  graphWeight?: number;
  graphMaxDepth?: number;
  filterOptions?: VectorSearchFilterOptions;
}

export interface RetrievedContext {
  rank: number;
  name: string;
  type?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  content?: string;
  score: number;
  vectorScore: number;
  graphScore: number;
  rerankScore?: number;
  sources: Array<"vector" | "graph">;
}

export interface RetrieverStats {
  rootDirectory: string;
  files: number;
  chunks: number;
  graphNodes: number;
  graphEdges: number;
}

const WRITE_VERBS_PATTERN = /^(?:create|write|generate|make|add|build|edit|modify|update|delete|remove)\b/i;
const WRITE_ACTION_PATTERN =
  /\b(?:create|write|generate|make|add|build|edit|modify|update|delete|remove)\s+(?:a\s+|new\s+)?(?:file\s+)?/i;
const LOCATION_PATTERN = /\b(?:where|find|locate|location|path)\b/i;
const CONTENT_PATTERN =
  /\b(?:show|read|display|contents?|lines?|functions?|classes?|interfaces?|symbols?|relationship|related|explain|works?|what does)\b/i;
const FILENAME_PATTERN = /(?:^|[\s"'`])([a-z0-9_$.-]+\.[a-z0-9]+)(?=$|[\s?.,!"'`])/i;
const SYMBOL_PATTERN = /\bwhere\s+is\s+([a-z_$][a-z0-9_$]*)\s+(?:implemented|defined|declared|located)\b/i;

export const parseRequestedFilename = (query: string): string | undefined => {
  const normalized = query.trim().toLowerCase();

  if (WRITE_VERBS_PATTERN.test(normalized) || WRITE_ACTION_PATTERN.test(normalized)) return undefined;
  if (LOCATION_PATTERN.test(normalized) && !CONTENT_PATTERN.test(normalized)) return query.match(FILENAME_PATTERN)?.[1];

  return undefined;
};

export const parseRequestedSymbol = (query: string): string | undefined => query.match(SYMBOL_PATTERN)?.[1];

export class CodeRetriever {
  private static readonly snapshots = new Map<
    string,
    { chunks: CodeChunk[]; graph: CodeGraph; fileCount: number; parsedFiles: ParsedFile[] }
  >();

  private readonly rootDirectory: string;
  private readonly repositoryName: string;
  private chunks: CodeChunk[] = [];
  private parsedFiles: ParsedFile[] = [];
  private graph?: CodeGraph;
  private initialized = false;
  private fileCount = 0;

  constructor(rootDirectory: string, repositoryName = "ai-chatbot") {
    this.rootDirectory = path.resolve(rootDirectory);
    this.repositoryName = repositoryName;
  }

  async initialize(): Promise<void> {
    const snapshotKey = `${this.rootDirectory}::${this.repositoryName}`;
    const snapshot = CodeRetriever.snapshots.get(snapshotKey);

    if (snapshot) {
      this.chunks = snapshot.chunks;
      this.graph = snapshot.graph;
      this.fileCount = snapshot.fileCount;
      this.parsedFiles = snapshot.parsedFiles;
      this.initialized = true;
      updateRetrievalRuntimeStatus({ graph: "ready", files: snapshot.fileCount, chunks: snapshot.chunks.length });
      return;
    }

    console.warn("Initializing Code Retriever...");
    updateRetrievalRuntimeStatus({ graph: "initializing", vector: "initializing" });

    const parsedFiles = (await parseRepository(this.rootDirectory)).map((f) => ({
      ...f,
      filePath: toRepositoryPath(this.rootDirectory, f.filePath),
    }));

    validateRepositoryScan(parsedFiles.length, 0);

    this.fileCount = parsedFiles.length;
    this.parsedFiles = parsedFiles;
    this.chunks = chunkRepository(parsedFiles);

    const currentHash = computeRepositoryHash(parsedFiles);
    const cached = await loadGraphCache();

    const { entities, relationships } =
      cached?.repositoryHash === currentHash
        ? (() => {
            console.warn("Loaded graph from disk cache (.cache/graphrag/graph.json)");
            metricsCollector.recordCacheHit(true);
            return cached;
          })()
        : (() => {
            console.warn("Graph cache miss / changed - extracting entities & relationships...");
            metricsCollector.recordCacheHit(false);
            const entities = extractEntities(parsedFiles);
            const relationships = extractRelationships(parsedFiles, entities);
            return { entities, relationships };
          })();

    if (cached?.repositoryHash !== currentHash) {
      await saveGraphCache({ repositoryHash: currentHash, entities, relationships });
      console.warn("Saved updated graph to disk cache.");
    }

    this.graph = buildGraph(entities, relationships);

    updateRetrievalRuntimeStatus({
      graph: "ready",
      files: parsedFiles.length,
      chunks: this.chunks.length,
      lastRefreshAt: new Date().toISOString(),
    });

    console.warn(
      `Parsed files: ${parsedFiles.length}\n` +
        `Code chunks: ${this.chunks.length}\n` +
        `Graph nodes: ${this.graph.nodes.size}\n` +
        `Graph edges: ${this.graph.edges.length}`,
    );

    try {
      console.warn("Persisting vector embeddings to MongoDB Atlas Vector Search...");
      await upsertChunks(this.repositoryName, this.chunks, currentHash, this.fileCount);
      updateRetrievalRuntimeStatus({ vector: "ready" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      updateRetrievalRuntimeStatus({ vector: "degraded", lastError: message });
      console.warn("MongoDB vector upsert skipped (running in AST graph mode):", message);
    } finally {
      this.initialized = true;
    }

    CodeRetriever.snapshots.set(snapshotKey, {
      chunks: this.chunks,
      graph: this.graph,
      fileCount: this.fileCount,
      parsedFiles: this.parsedFiles,
    });

    console.warn("Code Retriever ready.");
  }

  async refreshGraph(): Promise<void> {
    updateRetrievalRuntimeStatus({ graph: "initializing" });

    try {
      const parsedFiles = (await parseRepository(this.rootDirectory)).map((f) => ({
        ...f,
        filePath: toRepositoryPath(this.rootDirectory, f.filePath),
      }));

      validateRepositoryScan(parsedFiles.length, 0);

      const chunks = chunkRepository(parsedFiles);
      const entities = extractEntities(parsedFiles);
      const relationships = extractRelationships(parsedFiles, entities);
      const repositoryHash = computeRepositoryHash(parsedFiles);

      await saveGraphCache({ repositoryHash, entities, relationships });

      this.fileCount = parsedFiles.length;
      this.parsedFiles = parsedFiles;
      this.chunks = chunks;
      this.graph = buildGraph(entities, relationships);
      this.initialized = true;

      CodeRetriever.snapshots.set(`${this.rootDirectory}::${this.repositoryName}`, {
        chunks: this.chunks,
        graph: this.graph,
        fileCount: this.fileCount,
        parsedFiles: this.parsedFiles,
      });

      updateRetrievalRuntimeStatus({
        graph: "ready",
        files: parsedFiles.length,
        chunks: chunks.length,
        lastRefreshAt: new Date().toISOString(),
      });
    } catch (error) {
      updateRetrievalRuntimeStatus({
        graph: "unavailable",
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async retrieve(query: string, options: RetrieverOptions = {}): Promise<RetrievedContext[]> {
    if (!this.initialized || !this.graph) {
      throw new Error("Retriever is not initialized. Call initialize() first.");
    }

    const sanitizedQuery = validateQueryLength(query);
    const requestedLimit = validateTopK(options.limit);
    const startTotal = Date.now();
    const requestedFilename = parseRequestedFilename(sanitizedQuery)?.toLowerCase();

    const exactFileChunks = requestedFilename
      ? this.chunks.filter((c) => path.basename(c.filePath).toLowerCase() === requestedFilename)
      : [];

    const partialFileChunks =
      requestedFilename && exactFileChunks.length === 0
        ? this.chunks.filter((c) => path.basename(c.filePath).toLowerCase().includes(requestedFilename))
        : [];

    const fileLookupChunks = exactFileChunks.length > 0 ? exactFileChunks : partialFileChunks;

    if (fileLookupChunks.length > 0) {
      return this.buildFileLookupResults(fileLookupChunks, requestedLimit);
    }

    if (requestedFilename) {
      return [
        {
          rank: 1,
          name: requestedFilename,
          type: "file",
          filePath: "repository-index",
          startLine: 0,
          endLine: 0,
          content: `No ${requestedFilename} file exists in the indexed repository.`,
          score: 1,
          vectorScore: 0,
          graphScore: 0,
          rerankScore: 1,
          sources: ["vector"],
        },
      ];
    }

    return this.executeHybridSearch(sanitizedQuery, requestedLimit, options, startTotal);
  }

  private buildFileLookupResults(chunks: CodeChunk[], limit: number): RetrievedContext[] {
    const uniqueFiles = new Map<string, CodeChunk>();
    chunks.forEach((chunk) => {
      if (!uniqueFiles.has(chunk.filePath)) uniqueFiles.set(chunk.filePath, chunk);
    });

    const getDepth = (fp: string): number => fp.split(/[\\/]/).length;

    return [...uniqueFiles.values()]
      .sort((a, b) => getDepth(a.filePath) - getDepth(b.filePath) || a.filePath.localeCompare(b.filePath))
      .slice(0, limit)
      .map((chunk, i) => ({
        rank: i + 1,
        name: chunk.name ?? path.basename(chunk.filePath),
        type: chunk.type,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        score: 1,
        vectorScore: 1,
        graphScore: 0,
        rerankScore: 1,
        sources: ["vector"] as const,
      }));
  }

  private async executeHybridSearch(
    sanitizedQuery: string,
    requestedLimit: number,
    options: RetrieverOptions,
    startTotal: number,
  ): Promise<RetrievedContext[]> {
    let vectorResults: VectorSearchResult[] = [];
    let vectorMs = 0;

    try {
      const startVector = Date.now();
      vectorResults = await pgVectorSearch(sanitizedQuery, {
        repository: options.filterOptions?.repository ?? this.repositoryName,
        limit: 15,
      });
      vectorMs = Date.now() - startVector;
    } catch {
      console.warn("MongoDB vector search skipped (using graph & AST chunk search).");
    }

    try {
      const startGraph = Date.now();
      const hybridOptions: HybridSearchOptions = {
        limit: requestedLimit * 2,
        ...(options.vectorWeight !== undefined && { vectorWeight: options.vectorWeight }),
        ...(options.graphWeight !== undefined && { graphWeight: options.graphWeight }),
        ...(options.graphMaxDepth !== undefined && { graphMaxDepth: options.graphMaxDepth }),
      };
      const hybridResults = hybridSearch(sanitizedQuery, this.graph!, this.chunks, vectorResults, hybridOptions);
      const graphMs = Date.now() - startGraph;

      const startRerank = Date.now();
      const reranked = rerankResults(sanitizedQuery, hybridResults, { limit: requestedLimit, maxPerFile: 3 });
      const rerankMs = Date.now() - startRerank;
      const totalMs = Date.now() - startTotal;

      metricsCollector.recordRetrieval(totalMs, vectorMs, graphMs, rerankMs, true, sanitizedQuery, this.repositoryName);

      return reranked.map((result: RerankedResult, i: number) => {
        const context: RetrievedContext = {
          rank: i + 1,
          name: result.name,
          score: result.hybridScore,
          vectorScore: result.vectorScore,
          graphScore: result.graphScore,
          sources: result.sources,
        };
        if (result.chunk?.type) context.type = result.chunk.type;
        if (result.filePath) context.filePath = result.filePath;
        if (result.chunk?.startLine) context.startLine = result.chunk.startLine;
        if (result.chunk?.endLine) context.endLine = result.chunk.endLine;
        if (result.chunk?.content) context.content = result.chunk.content;
        if (result.rerankScore) context.rerankScore = result.rerankScore;
        return context;
      });
    } catch (err) {
      metricsCollector.recordRetrieval(Date.now() - startTotal, 0, 0, 0, false);
      throw err;
    }
  }

  async search(request: { readonly query: string; readonly limit?: number }): Promise<
    readonly {
      readonly content: string;
      readonly source: string;
      readonly score: number;
      readonly metadata?: Readonly<Record<string, string>>;
    }[]
  > {
    if (!this.initialized) return [];

    const requestedSymbol = parseRequestedSymbol(request.query);

    if (requestedSymbol) {
      return this.findSymbolChunks(requestedSymbol, request.limit ?? 10);
    }

    const retrieveOptions: RetrieverOptions = {};
    if (request.limit !== undefined) retrieveOptions.limit = request.limit;
    const results = await this.retrieve(request.query, retrieveOptions);
    const requestedFilename = parseRequestedFilename(request.query);

    return results.map((r) => {
      const metadata: Record<string, string> = {
        type: requestedFilename ? "file_lookup" : r.type || "",
        startLine: String(r.startLine || 0),
        endLine: String(r.endLine || 0),
        retrievalSources: r.sources.join(","),
      };

      if (requestedFilename) metadata.requestedFilename = requestedFilename;
      if (requestedFilename && r.filePath && r.filePath !== "repository-index") {
        metadata.filePath = r.filePath;
        metadata.pathValidated = "true";
      }

      return {
        content: r.content || r.name,
        source:
          r.filePath && r.filePath !== "repository-index"
            ? path.resolve(this.rootDirectory, r.filePath)
            : r.filePath || r.name,
        score: r.score,
        metadata,
      };
    });
  }

  private findSymbolChunks(
    symbol: string,
    limit: number,
  ): Array<{
    content: string;
    source: string;
    score: number;
    metadata: Record<string, string>;
  }> {
    return this.chunks
      .filter(
        (c) =>
          c.name?.toLowerCase() === symbol.toLowerCase() && existsSync(path.resolve(this.rootDirectory, c.filePath)),
      )
      .slice(0, limit)
      .map((chunk) => {
        const relativePath = chunk.filePath.replace(/\\/g, "/");
        return {
          content: chunk.content,
          source: path.resolve(this.rootDirectory, relativePath),
          score: 1,
          metadata: {
            type: "symbol_lookup",
            symbol,
            filePath: relativePath,
            startLine: String(chunk.startLine),
            endLine: String(chunk.endLine),
            pathValidated: "true",
            retrievalSources: "ast",
          },
        };
      });
  }

  findSymbolReferences(symbol: string): SymbolReferenceReport {
    if (!this.initialized) {
      throw new Error("Retriever is not initialized. Call initialize() first.");
    }
    return findAstSymbolReferences(this.parsedFiles, symbol);
  }

  getStats(): RetrieverStats {
    if (!this.initialized || !this.graph) {
      throw new Error("Retriever is not initialized.");
    }

    return {
      rootDirectory: this.rootDirectory,
      files: this.fileCount,
      chunks: this.chunks.length,
      graphNodes: this.graph.nodes.size,
      graphEdges: this.graph.edges.length,
    };
  }
}
