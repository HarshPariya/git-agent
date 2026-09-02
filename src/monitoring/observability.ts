import { pool } from "../db/postgres.js";

export interface PercentileMetrics {
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface SlowQueryRecord {
  timestamp: string;
  query: string;
  repository: string;
  totalMs: number;
  vectorMs: number;
  graphMs: number;
  rerankMs: number;
}

export interface RepositoryMetricSummary {
  repository: string;
  totalRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
}

export interface SystemMetrics {
  healthScore: {
    status: "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL";
    scorePercentage: number;
    description: string;
  };
  retrieval: {
    totalRequests: number;
    failedRequests: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    percentiles: PercentileMetrics;
    vectorLatencyMs: number;
    graphLatencyMs: number;
    rerankLatencyMs: number;
  };
  database: {
    totalQueries: number;
    failedQueries: number;
    poolTotalConnections: number;
    poolIdleConnections: number;
    poolWaitingCount: number;
  };
  embeddings: {
    modelLoadTimeMs: number;
    totalEmbeddings: number;
    failedEmbeddings: number;
    avgLatencyMs: number;
  };
  graphCache: {
    hits: number;
    misses: number;
    hitRate: string;
  };
  indexing: {
    totalIndexedFiles: number;
    totalDeletedFiles: number;
    lastIndexingDurationMs: number;
  };
  slowQueries: SlowQueryRecord[];
  perRepository: Record<string, RepositoryMetricSummary>;
}

class MetricsCollector {
  private retrievalRequests = 0;
  private failedRetrievals = 0;
  private totalRetrievalLatencyMs = 0;
  private totalVectorLatencyMs = 0;
  private totalGraphLatencyMs = 0;
  private totalRerankLatencyMs = 0;

  private latencySamples: number[] = [];
  private slowQueries: SlowQueryRecord[] = [];
  private repoMetricsMap = new Map<
    string,
    { total: number; failed: number; totalLatencyMs: number }
  >();

  private dbQueries = 0;
  private failedDbQueries = 0;

  private cacheHits = 0;
  private cacheMisses = 0;

  private indexedFiles = 0;
  private deletedFiles = 0;
  private lastIndexingDurationMs = 0;

  private readonly SLOW_QUERY_THRESHOLD_MS = 100;

  public recordRetrieval(
    totalMs: number,
    vectorMs: number,
    graphMs: number,
    rerankMs: number,
    success = true,
    queryText = "",
    repository = "ai-chatbot",
  ): void {
    this.retrievalRequests++;
    if (!success) {
      this.failedRetrievals++;
    }

    this.totalRetrievalLatencyMs += totalMs;
    this.totalVectorLatencyMs += vectorMs;
    this.totalGraphLatencyMs += graphMs;
    this.totalRerankLatencyMs += rerankMs;

    this.latencySamples.push(totalMs);
    if (this.latencySamples.length > 1000) {
      this.latencySamples.shift();
    }

    // Record per-repository metrics
    const repoStats = this.repoMetricsMap.get(repository) ?? {
      total: 0,
      failed: 0,
      totalLatencyMs: 0,
    };
    repoStats.total++;
    if (!success) repoStats.failed++;
    repoStats.totalLatencyMs += totalMs;
    this.repoMetricsMap.set(repository, repoStats);

    // Record slow query log if latency exceeds threshold
    if (totalMs >= this.SLOW_QUERY_THRESHOLD_MS && queryText) {
      this.slowQueries.push({
        timestamp: new Date().toISOString(),
        query: queryText,
        repository,
        totalMs,
        vectorMs,
        graphMs,
        rerankMs,
      });

      if (this.slowQueries.length > 50) {
        this.slowQueries.shift(); // Keep latest 50 slow queries
      }
    }
  }

  public recordDbQuery(success = true): void {
    this.dbQueries++;
    if (!success) {
      this.failedDbQueries++;
    }
  }

  public recordCacheHit(hit: boolean): void {
    if (hit) {
      this.cacheHits++;
    } else {
      this.cacheMisses++;
    }
  }

  public recordRagMetrics(metrics: {
    retrievalMode: string;
    retrievedCandidates: number;
    rerankedCandidates: number;
    sentToLLM: number;
    ragContextTokens: number;
    memoryTokens: number;
    systemTokens: number;
    queryTokens: number;
    llmInputTokens: number;
    llmOutputTokens: number;
  }): void {
    console.log(
      `[RAG METRICS] mode: ${metrics.retrievalMode} | retrieved: ${metrics.retrievedCandidates} | reranked: ${metrics.rerankedCandidates} | sentToLLM: ${metrics.sentToLLM} | ragTokens: ${metrics.ragContextTokens} | memTokens: ${metrics.memoryTokens} | totalInputTokens: ${metrics.llmInputTokens}`,
    );
  }

  public recordIndexing(indexed: number, deleted: number, durationMs: number): void {
    this.indexedFiles += indexed;
    this.deletedFiles += deleted;
    this.lastIndexingDurationMs = durationMs;
  }

  private calculatePercentiles(): PercentileMetrics {
    if (this.latencySamples.length === 0) {
      return { p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0 };
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const getPercentile = (p: number) => {
      const idx = Math.ceil((p / 100) * sorted.length) - 1;
      return sorted[Math.max(0, idx)] ?? 0;
    };

    return {
      p50Ms: getPercentile(50),
      p90Ms: getPercentile(90),
      p95Ms: getPercentile(95),
      p99Ms: getPercentile(99),
    };
  }

  public calculateHealthScore(): SystemMetrics["healthScore"] {
    if (this.retrievalRequests === 0) {
      return {
        status: "EXCELLENT",
        scorePercentage: 100,
        description: "System idle and fully healthy.",
      };
    }

    const failureRate = this.failedRetrievals / this.retrievalRequests;
    const percentiles = this.calculatePercentiles();

    let score = 100 - failureRate * 100 * 2;
    if (percentiles.p95Ms > 200) score -= 15;
    if (percentiles.p95Ms > 500) score -= 25;

    score = Math.max(0, Math.min(100, Math.round(score)));

    let status: SystemMetrics["healthScore"]["status"] = "EXCELLENT";
    if (score < 95) status = "GOOD";
    if (score < 80) status = "DEGRADED";
    if (score < 50) status = "CRITICAL";

    return {
      status,
      scorePercentage: score,
      description: `RAG retrieval SLA health score at ${score}% (${status}). P95 latency: ${percentiles.p95Ms}ms.`,
    };
  }

  public getMetrics(embeddingStats?: {
    modelLoadTimeMs: number;
    totalEmbeddings: number;
    failedEmbeddings: number;
    averageLatencyMs: number;
  }): SystemMetrics {
    const totalCache = this.cacheHits + this.cacheMisses;
    const hitRatePercent =
      totalCache > 0
        ? `${((this.cacheHits / totalCache) * 100).toFixed(1)}%`
        : "0.0%";

    const perRepoObj: Record<string, RepositoryMetricSummary> = {};
    for (const [repo, data] of this.repoMetricsMap.entries()) {
      perRepoObj[repo] = {
        repository: repo,
        totalRequests: data.total,
        failedRequests: data.failed,
        avgLatencyMs: data.total > 0 ? Math.round(data.totalLatencyMs / data.total) : 0,
      };
    }

    return {
      healthScore: this.calculateHealthScore(),
      retrieval: {
        totalRequests: this.retrievalRequests,
        failedRequests: this.failedRetrievals,
        totalLatencyMs: this.totalRetrievalLatencyMs,
        avgLatencyMs:
          this.retrievalRequests > 0
            ? Math.round(this.totalRetrievalLatencyMs / this.retrievalRequests)
            : 0,
        percentiles: this.calculatePercentiles(),
        vectorLatencyMs:
          this.retrievalRequests > 0
            ? Math.round(this.totalVectorLatencyMs / this.retrievalRequests)
            : 0,
        graphLatencyMs:
          this.retrievalRequests > 0
            ? Math.round(this.totalGraphLatencyMs / this.retrievalRequests)
            : 0,
        rerankLatencyMs:
          this.retrievalRequests > 0
            ? Math.round(this.totalRerankLatencyMs / this.retrievalRequests)
            : 0,
      },
      database: {
        totalQueries: this.dbQueries,
        failedQueries: this.failedDbQueries,
        poolTotalConnections: pool.totalCount ?? 0,
        poolIdleConnections: pool.idleCount ?? 0,
        poolWaitingCount: pool.waitingCount ?? 0,
      },
      embeddings: {
        modelLoadTimeMs: embeddingStats?.modelLoadTimeMs ?? 0,
        totalEmbeddings: embeddingStats?.totalEmbeddings ?? 0,
        failedEmbeddings: embeddingStats?.failedEmbeddings ?? 0,
        avgLatencyMs: embeddingStats?.averageLatencyMs ?? 0,
      },
      graphCache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: hitRatePercent,
      },
      indexing: {
        totalIndexedFiles: this.indexedFiles,
        totalDeletedFiles: this.deletedFiles,
        lastIndexingDurationMs: this.lastIndexingDurationMs,
      },
      slowQueries: this.slowQueries,
      perRepository: perRepoObj,
    };
  }

  public getPrometheusFormat(embeddingStats?: {
    modelLoadTimeMs: number;
    totalEmbeddings: number;
    failedEmbeddings: number;
    averageLatencyMs: number;
  }): string {
    const metrics = this.getMetrics(embeddingStats);
    return [
      `# HELP rag_retrieval_requests_total Total number of retrieval requests`,
      `# TYPE rag_retrieval_requests_total counter`,
      `rag_retrieval_requests_total{status="success"} ${metrics.retrieval.totalRequests - metrics.retrieval.failedRequests}`,
      `rag_retrieval_requests_total{status="failed"} ${metrics.retrieval.failedRequests}`,
      ``,
      `# HELP rag_retrieval_health_score System SLA health percentage`,
      `# TYPE rag_retrieval_health_score gauge`,
      `rag_retrieval_health_score ${metrics.healthScore.scorePercentage}`,
      ``,
      `# HELP rag_retrieval_latency_ms Retrieval latency in milliseconds`,
      `# TYPE rag_retrieval_latency_ms summary`,
      `rag_retrieval_latency_ms{quantile="0.5"} ${metrics.retrieval.percentiles.p50Ms}`,
      `rag_retrieval_latency_ms{quantile="0.9"} ${metrics.retrieval.percentiles.p90Ms}`,
      `rag_retrieval_latency_ms{quantile="0.95"} ${metrics.retrieval.percentiles.p95Ms}`,
      `rag_retrieval_latency_ms{quantile="0.99"} ${metrics.retrieval.percentiles.p99Ms}`,
      `rag_retrieval_latency_ms_avg ${metrics.retrieval.avgLatencyMs}`,
      ``,
      `# HELP rag_db_pool_connections Active database connections`,
      `# TYPE rag_db_pool_connections gauge`,
      `rag_db_pool_connections{state="total"} ${metrics.database.poolTotalConnections}`,
      `rag_db_pool_connections{state="idle"} ${metrics.database.poolIdleConnections}`,
      `rag_db_pool_connections{state="waiting"} ${metrics.database.poolWaitingCount}`,
      ``,
      `# HELP rag_cache_hit_rate Graph cache hit rate`,
      `# TYPE rag_cache_hit_rate gauge`,
      `rag_cache_hits_total ${metrics.graphCache.hits}`,
      `rag_cache_misses_total ${metrics.graphCache.misses}`,
    ].join("\n");
  }
}

export const metricsCollector = new MetricsCollector();
