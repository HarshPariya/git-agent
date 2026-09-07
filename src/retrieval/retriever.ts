import path from "node:path";
import { existsSync } from "node:fs";
import { parseRepository, type ParsedFile } from "../ingestion/parser.js";
import { chunkRepository, type CodeChunk } from "../ingestion/chunker.js";
import { extractEntities } from "../graph/entity-extractor.js";
import { extractRelationships } from "../graph/relationship-extractor.js";
import { buildGraph, type CodeGraph } from "../graph/graph-builder.js";
import {
  computeRepositoryHash,
  loadGraphCache,
  saveGraphCache,
} from "../graph/graph-cache.js";
import {
  pgVectorSearch,
  upsertChunks,
  type VectorSearchFilterOptions,
} from "../db/vector-store.js";
import { hybridSearch } from "./hybrid-search.js";
import { rerankResults, type RerankedResult } from "./reranker.js";
import {
  validateQueryLength,
  validateTopK,
  validateRepositoryScan,
} from "../guardrails/retrieval-limits.js";
import { metricsCollector } from "../monitoring/observability.js";
import { setHnswSearchPrecision } from "../db/hnsw-tuning.js";
import { toRepositoryPath } from "./repository-path.js";
import { updateRetrievalRuntimeStatus } from "./runtime-status.js";
import { findAstSymbolReferences } from "./ast-reference-search.js";
import type { SymbolReferenceReport } from "./types.js";

export interface RetrieverOptions {
  limit?: number | undefined;
  vectorWeight?: number | undefined;
  graphWeight?: number | undefined;
  graphMaxDepth?: number | undefined;
  filterOptions?: VectorSearchFilterOptions | undefined;
}

export interface RetrievedContext {
  rank: number;
  name: string;
  type?: string | undefined;
  filePath?: string | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  content?: string | undefined;
  score: number;
  vectorScore: number;
  graphScore: number;
  rerankScore?: number | undefined;
  sources: Array<"vector" | "graph">;
}

export interface RetrieverStats {
  rootDirectory: string;
  files: number;
  chunks: number;
  graphNodes: number;
  graphEdges: number;
}

export function parseRequestedFilename(query: string): string | undefined {
  const normalized = query.trim().toLowerCase();
  const isActionIntent =
    /^(?:create|write|generate|make|add|build|edit|modify|update|delete|remove)\b/i.test(normalized) ||
    /\b(?:create|write|generate|make|add|build|edit|modify|update|delete|remove)\s+(?:a\s+|new\s+)?(?:file\s+)?/i.test(normalized);

  if (isActionIntent) {
    return undefined;
  }

  const isLocationIntent =
    /\b(?:where|find|locate|location|path)\b/i.test(normalized) &&
    !/\b(?:show|read|display|contents?|lines?|functions?|classes?|interfaces?|symbols?|relationship|related|explain|works?|what does)\b/i.test(normalized);
  if (!isLocationIntent) {
    return undefined;
  }

  return query.match(/(?:^|[\s"'`])([a-z0-9_$.-]+\.[a-z0-9]+)(?=$|[\s?.,!"'`])/i)?.[1];
}

export function parseRequestedSymbol(query: string): string | undefined {
  return query.match(/\bwhere\s+is\s+([a-z_$][a-z0-9_$]*)\s+(?:implemented|defined|declared|located)\b/i)?.[1];
}

export class CodeRetriever {
  private static readonly snapshots = new Map<string, {
    chunks: CodeChunk[];
    graph: CodeGraph;
    fileCount: number;
    parsedFiles: ParsedFile[];
  }>();
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
      updateRetrievalRuntimeStatus({
        graph: "ready",
        files: snapshot.fileCount,
        chunks: snapshot.chunks.length,
      });
      return;
    }
    console.log("🔍 Initializing Code Retriever...");

    updateRetrievalRuntimeStatus({ graph: "initializing", vector: "initializing", lastError: undefined });
    const parsedFiles = (await parseRepository(this.rootDirectory)).map((file) => ({
      ...file,
      filePath: toRepositoryPath(this.rootDirectory, file.filePath),
    }));
    validateRepositoryScan(parsedFiles.length, 0);

    this.fileCount = parsedFiles.length;
    this.parsedFiles = parsedFiles;
    this.chunks = chunkRepository(parsedFiles);

    const currentHash = computeRepositoryHash(parsedFiles);
    const cached = await loadGraphCache();

    let entities;
    let relationships;

    if (cached && cached.repositoryHash === currentHash) {
      console.log("⚡ Loaded graph from disk cache (.cache/graphrag/graph.json)");
      metricsCollector.recordCacheHit(true);
      entities = cached.entities;
      relationships = cached.relationships;
    } else {
      console.log("🛠 Graph cache miss / changed — extracting entities & relationships...");
      metricsCollector.recordCacheHit(false);
      entities = extractEntities(parsedFiles);
      relationships = extractRelationships(parsedFiles, entities);
      await saveGraphCache({
        repositoryHash: currentHash,
        entities,
        relationships,
      });
      console.log("✓ Saved updated graph to disk cache.");
    }

    this.graph = buildGraph(entities, relationships);
    updateRetrievalRuntimeStatus({
      graph: "ready",
      files: parsedFiles.length,
      chunks: this.chunks.length,
      lastRefreshAt: new Date().toISOString(),
    });

    console.log(`✓ Parsed files: ${parsedFiles.length}`);
    console.log(`✓ Code chunks: ${this.chunks.length}`);
    console.log(`✓ Graph nodes: ${this.graph.nodes.size}`);
    console.log(`✓ Graph edges: ${this.graph.edges.length}`);

    try {
      console.log("💾 Persisting vector embeddings to PostgreSQL + pgvector...");
      await upsertChunks(
        this.repositoryName,
        this.chunks,
        currentHash,
        this.fileCount,
      );
      updateRetrievalRuntimeStatus({ vector: "ready" });
    } catch (err: any) {
      updateRetrievalRuntimeStatus({ vector: "degraded", lastError: err?.message || String(err) });
      console.warn("⚠️ Postgres vector upsert skipped (running in AST graph mode):", err?.message || err);
    }

    this.initialized = true;
    CodeRetriever.snapshots.set(snapshotKey, {
      chunks: this.chunks,
      graph: this.graph,
      fileCount: this.fileCount,
      parsedFiles: this.parsedFiles,
    });
    console.log("✓ Code Retriever ready.");
  }

  /** Refreshes the in-memory AST graph after incremental file indexing. */
  async refreshGraph(): Promise<void> {
    updateRetrievalRuntimeStatus({ graph: "initializing" });
    try {
      const parsedFiles = (await parseRepository(this.rootDirectory)).map((file) => ({
        ...file,
        filePath: toRepositoryPath(this.rootDirectory, file.filePath),
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

  async retrieve(
    query: string,
    options: RetrieverOptions = {},
  ): Promise<RetrievedContext[]> {
    if (!this.initialized || !this.graph) {
      throw new Error(
        "Retriever is not initialized. Call initialize() first.",
      );
    }

    const sanitizedQuery = validateQueryLength(query);
    const requestedLimit = validateTopK(options.limit);
    const startTotal = Date.now();

    // Location questions containing a literal filename are deterministic and
    // should not depend on vector similarity or graph entities.
    const requestedFilename = parseRequestedFilename(sanitizedQuery)?.toLowerCase();
    const exactFileChunks = requestedFilename ? this.chunks.filter((chunk) => {
      const basename = path.basename(chunk.filePath).toLowerCase();
      return basename === requestedFilename;
    }) : [];
    const partialFileChunks = requestedFilename && exactFileChunks.length === 0
      ? this.chunks.filter((chunk) => path.basename(chunk.filePath).toLowerCase().includes(requestedFilename))
      : [];
    const fileLookupChunks = exactFileChunks.length > 0 ? exactFileChunks : partialFileChunks;

    if (fileLookupChunks.length > 0) {
      const uniqueFiles = new Map<string, CodeChunk>();
      for (const chunk of fileLookupChunks) {
        if (!uniqueFiles.has(chunk.filePath)) uniqueFiles.set(chunk.filePath, chunk);
      }
      return [...uniqueFiles.values()]
        .sort((a, b) => {
          const depth = (filePath: string) => filePath.split(/[\\/]/).length;
          return depth(a.filePath) - depth(b.filePath) || a.filePath.localeCompare(b.filePath);
        })
        .slice(0, requestedLimit)
        .map((chunk, index) => ({
        rank: index + 1,
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
        sources: ["vector"],
        }));
    }

    if (requestedFilename) {
      return [{
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
      }];
    }

    try {
      let vectorResults: any[] = [];
      let vectorMs = 0;

      try {
        await setHnswSearchPrecision(100);
        const startVector = Date.now();
        vectorResults = await pgVectorSearch(sanitizedQuery, {
          repository: options.filterOptions?.repository ?? this.repositoryName,
          language: options.filterOptions?.language,
          chunkType: options.filterOptions?.chunkType,
          filePathPrefix: options.filterOptions?.filePathPrefix,
          metadata: options.filterOptions?.metadata,
          limit: 15,
        });
        vectorMs = Date.now() - startVector;
      } catch (err: any) {
        console.warn("⚠️ Postgres vector search skipped (using graph & AST chunk search).");
      }

      const startGraph = Date.now();
      const hybridResults = await hybridSearch(
        sanitizedQuery,
        this.graph,
        this.chunks,
        vectorResults,
        {
          limit: requestedLimit * 2,
          vectorWeight: options.vectorWeight,
          graphWeight: options.graphWeight,
          graphMaxDepth: options.graphMaxDepth,
        },
      );
      const graphMs = Date.now() - startGraph;

      const startRerank = Date.now();
      const reranked = rerankResults(sanitizedQuery, hybridResults, {
        limit: requestedLimit,
        maxPerFile: 3,
      });
      const rerankMs = Date.now() - startRerank;

      const totalMs = Date.now() - startTotal;
      metricsCollector.recordRetrieval(
        totalMs,
        vectorMs,
        graphMs,
        rerankMs,
        true,
        sanitizedQuery,
        this.repositoryName,
      );

      return reranked.map((result: RerankedResult, index: number) => ({
        rank: index + 1,
        name: result.name,
        type: result.chunk?.type,
        filePath: result.filePath,
        startLine: result.chunk?.startLine,
        endLine: result.chunk?.endLine,
        content: result.chunk?.content,
        score: result.hybridScore,
        vectorScore: result.vectorScore,
        graphScore: result.graphScore,
        rerankScore: result.rerankScore,
        sources: result.sources,
      }));
    } catch (err) {
      const totalMs = Date.now() - startTotal;
      metricsCollector.recordRetrieval(totalMs, 0, 0, 0, false);
      throw err;
    }
  }

  async search(request: { readonly query: string; readonly limit?: number }): Promise<readonly { readonly content: string; readonly source: string; readonly score: number; readonly metadata?: Readonly<Record<string, string>> }[]> {
    if (!this.initialized) {
      return [];
    }
    const requestedSymbol = parseRequestedSymbol(request.query);
    if (requestedSymbol) {
      const matches = this.chunks.filter(
        (chunk) => chunk.name?.toLowerCase() === requestedSymbol.toLowerCase() &&
          existsSync(path.resolve(this.rootDirectory, chunk.filePath)),
      );
      return matches.slice(0, request.limit ?? 10).map((chunk) => {
        const relativePath = chunk.filePath.replace(/\\/g, "/");
        return {
          content: chunk.content,
          source: path.resolve(this.rootDirectory, relativePath),
          score: 1,
          metadata: {
            type: "symbol_lookup",
            symbol: requestedSymbol,
            filePath: relativePath,
            startLine: String(chunk.startLine),
            endLine: String(chunk.endLine),
            pathValidated: "true",
            retrievalSources: "ast",
          },
        };
      });
    }
    const results = await this.retrieve(request.query, { limit: request.limit });
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
        source: r.filePath && r.filePath !== "repository-index"
          ? path.resolve(this.rootDirectory, r.filePath)
          : r.filePath || r.name,
        score: r.score,
        metadata,
      };
    });
  }

  async findSymbolReferences(symbol: string): Promise<SymbolReferenceReport> {
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
