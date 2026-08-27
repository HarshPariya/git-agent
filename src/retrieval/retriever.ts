import path from "node:path";
import { parseRepository } from "../ingestion/parser.js";
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

export class CodeRetriever {
  private readonly rootDirectory: string;
  private readonly repositoryName: string;

  private chunks: CodeChunk[] = [];
  private graph?: CodeGraph;
  private initialized = false;
  private fileCount = 0;

  constructor(rootDirectory: string, repositoryName = "ai-chatbot") {
    this.rootDirectory = path.resolve(rootDirectory);
    this.repositoryName = repositoryName;
  }

  async initialize(): Promise<void> {
    console.log("🔍 Initializing Code Retriever...");

    const parsedFiles = await parseRepository(this.rootDirectory);
    validateRepositoryScan(parsedFiles.length, 0);

    this.fileCount = parsedFiles.length;
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

    console.log(`✓ Parsed files: ${parsedFiles.length}`);
    console.log(`✓ Code chunks: ${this.chunks.length}`);
    console.log(`✓ Graph nodes: ${this.graph.nodes.size}`);
    console.log(`✓ Graph edges: ${this.graph.edges.length}`);

    console.log("💾 Persisting vector embeddings to PostgreSQL + pgvector...");
    await upsertChunks(
      this.repositoryName,
      this.chunks,
      currentHash,
      this.fileCount,
    );

    this.initialized = true;
    console.log("✓ Code Retriever ready.");
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

    try {
      await setHnswSearchPrecision(100);

      const startVector = Date.now();
      const vectorResults = await pgVectorSearch(sanitizedQuery, {
        repository: options.filterOptions?.repository ?? this.repositoryName,
        language: options.filterOptions?.language,
        chunkType: options.filterOptions?.chunkType,
        filePathPrefix: options.filterOptions?.filePathPrefix,
        metadata: options.filterOptions?.metadata,
        limit: 15,
      });
      const vectorMs = Date.now() - startVector;

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
