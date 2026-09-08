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

const SLOW_QUERY_THRESHOLD_MS = 100;
const MAX_LATENCY_SAMPLES = 1000;
const MAX_SLOW_QUERIES = 50;

const calculatePercentile = (sorted: readonly number[], p: number): number =>
  sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;

const avgLatency = (total: number, count: number): number =>
  count > 0 ? Math.round(total / count) : 0;

const buildHealthScore = (
  score: number,
  percentiles: PercentileMetrics,
): SystemMetrics["healthScore"] => {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const status: SystemMetrics["healthScore"]["status"] =
    clamped >= 95 ? "EXCELLENT" :
    clamped >= 80 ? "GOOD" :
    clamped >= 50 ? "DEGRADED" : "CRITICAL";

  return {
    status,
    scorePercentage: clamped,
    description: `RAG retrieval SLA health score at ${clamped}% (${status}). P95 latency: ${percentiles.p95Ms}ms.`,
  };
};

const buildPerRepoSummary = (map: Map<string, { total: number; failed: number; totalLatencyMs: number }>): Record<string, RepositoryMetricSummary> => {
  const result: Record<string, RepositoryMetricSummary> = {};
  for (const [repo, data] of map.entries()) {
    result[repo] = {
      repository: repo,
      totalRequests: data.total,
      failedRequests: data.failed,
      avgLatencyMs: data.total > 0 ? Math.round(data.totalLatencyMs / data.total) : 0,
    };
  }
  return result;
};

class MetricsCollector {
  private retrievalRequests = 0;
  private failedRetrievals = 0;
  private totalRetrievalLatencyMs = 0;
  private totalVectorLatencyMs = 0;
  private totalGraphLatencyMs = 0;
  private totalRerankLatencyMs = 0;
  private latencySamples: number[] = [];
  private slowQueries: SlowQueryRecord[] = [];
  private repoMetricsMap = new Map<string, { total: number; failed: number; totalLatencyMs: number }>();
  private dbQueries = 0;
  private failedDbQueries = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private indexedFiles = 0;
  private deletedFiles = 0;
  private lastIndexingDurationMs = 0;

  recordRetrieval(totalMs: number, vectorMs: number, graphMs: number, rerankMs: number, success = true, queryText = "", repository = "ai-chatbot"): void {
    this.retrievalRequests++;
    if (!success) this.failedRetrievals++;
    this.totalRetrievalLatencyMs += totalMs;
    this.totalVectorLatencyMs += vectorMs;
    this.totalGraphLatencyMs += graphMs;
    this.totalRerankLatencyMs += rerankMs;
    this.latencySamples.push(totalMs);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) this.latencySamples.shift();

    const repoStats = this.repoMetricsMap.get(repository) ?? { total: 0, failed: 0, totalLatencyMs: 0 };
    repoStats.total++;
    if (!success) repoStats.failed++;
    repoStats.totalLatencyMs += totalMs;
    this.repoMetricsMap.set(repository, repoStats);

    if (totalMs >= SLOW_QUERY_THRESHOLD_MS && queryText) {
      this.slowQueries.push({
        timestamp: new Date().toISOString(),
        query: queryText,
        repository,
        totalMs,
        vectorMs,
        graphMs,
        rerankMs,
      });
      if (this.slowQueries.length > MAX_SLOW_QUERIES) this.slowQueries.shift();
    }
  }

  recordDbQuery = (success = true): void => {
    this.dbQueries++;
    if (!success) this.failedDbQueries++;
  };

  recordCacheHit = (hit: boolean): void => {
    hit ? this.cacheHits++ : this.cacheMisses++;
  };

  recordRagMetrics(metrics: {
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

  recordIndexing(indexed: number, deleted: number, durationMs: number): void {
    this.indexedFiles += indexed;
    this.deletedFiles += deleted;
    this.lastIndexingDurationMs = durationMs;
  }

  calculatePercentiles = (): PercentileMetrics => {
    if (this.latencySamples.length === 0) return { p50Ms: 0, p90Ms: 0, p95Ms: 0, p99Ms: 0 };
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    return {
      p50Ms: calculatePercentile(sorted, 50),
      p90Ms: calculatePercentile(sorted, 90),
      p95Ms: calculatePercentile(sorted, 95),
      p99Ms: calculatePercentile(sorted, 99),
    };
  };

  calculateHealthScore = (): SystemMetrics["healthScore"] => {
    if (this.retrievalRequests === 0) {
      return { status: "EXCELLENT", scorePercentage: 100, description: "System idle and fully healthy." };
    }

    const percentiles = this.calculatePercentiles();
    const failureRate = this.failedRetrievals / this.retrievalRequests;
    let score = 100 - failureRate * 200;
    score -= percentiles.p95Ms > 500 ? 25 : percentiles.p95Ms > 200 ? 15 : 0;

    return buildHealthScore(score, percentiles);
  };

  getMetrics(embeddingStats?: {
    modelLoadTimeMs: number;
    totalEmbeddings: number;
    failedEmbeddings: number;
    averageLatencyMs: number;
  }): SystemMetrics {
    const totalCache = this.cacheHits + this.cacheMisses;
    const hitRatePercent = totalCache > 0 ? `${((this.cacheHits / totalCache) * 100).toFixed(1)}%` : "0.0%";

    return {
      healthScore: this.calculateHealthScore(),
      retrieval: {
        totalRequests: this.retrievalRequests,
        failedRequests: this.failedRetrievals,
        totalLatencyMs: this.totalRetrievalLatencyMs,
        avgLatencyMs: avgLatency(this.totalRetrievalLatencyMs, this.retrievalRequests),
        percentiles: this.calculatePercentiles(),
        vectorLatencyMs: avgLatency(this.totalVectorLatencyMs, this.retrievalRequests),
        graphLatencyMs: avgLatency(this.totalGraphLatencyMs, this.retrievalRequests),
        rerankLatencyMs: avgLatency(this.totalRerankLatencyMs, this.retrievalRequests),
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
      graphCache: { hits: this.cacheHits, misses: this.cacheMisses, hitRate: hitRatePercent },
      indexing: {
        totalIndexedFiles: this.indexedFiles,
        totalDeletedFiles: this.deletedFiles,
        lastIndexingDurationMs: this.lastIndexingDurationMs,
      },
      slowQueries: this.slowQueries,
      perRepository: buildPerRepoSummary(this.repoMetricsMap),
    };
  }

  getPrometheusFormat(embeddingStats?: {
    modelLoadTimeMs: number;
    totalEmbeddings: number;
    failedEmbeddings: number;
    averageLatencyMs: number;
  }): string {
    const m = this.getMetrics(embeddingStats);
    return [
      `# HELP rag_retrieval_requests_total Total number of retrieval requests`,
      `# TYPE rag_retrieval_requests_total counter`,
      `rag_retrieval_requests_total{status="success"} ${m.retrieval.totalRequests - m.retrieval.failedRequests}`,
      `rag_retrieval_requests_total{status="failed"} ${m.retrieval.failedRequests}`,
      `# HELP rag_retrieval_health_score System SLA health percentage`,
      `# TYPE rag_retrieval_health_score gauge`,
      `rag_retrieval_health_score ${m.healthScore.scorePercentage}`,
      `# HELP rag_retrieval_latency_ms Retrieval latency in milliseconds`,
      `# TYPE rag_retrieval_latency_ms summary`,
      `rag_retrieval_latency_ms{quantile="0.5"} ${m.retrieval.percentiles.p50Ms}`,
      `rag_retrieval_latency_ms{quantile="0.9"} ${m.retrieval.percentiles.p90Ms}`,
      `rag_retrieval_latency_ms{quantile="0.95"} ${m.retrieval.percentiles.p95Ms}`,
      `rag_retrieval_latency_ms{quantile="0.99"} ${m.retrieval.percentiles.p99Ms}`,
      `rag_retrieval_latency_ms_avg ${m.retrieval.avgLatencyMs}`,
      `# HELP rag_db_pool_connections Active database connections`,
      `# TYPE rag_db_pool_connections gauge`,
      `rag_db_pool_connections{state="total"} ${m.database.poolTotalConnections}`,
      `rag_db_pool_connections{state="idle"} ${m.database.poolIdleConnections}`,
      `rag_db_pool_connections{state="waiting"} ${m.database.poolWaitingCount}`,
      `# HELP rag_cache_hit_rate Graph cache hit rate`,
      `# TYPE rag_cache_hit_rate gauge`,
      `rag_cache_hits_total ${m.graphCache.hits}`,
      `rag_cache_misses_total ${m.graphCache.misses}`,
    ].join("\n");
  }
}

export const metricsCollector = new MetricsCollector();
