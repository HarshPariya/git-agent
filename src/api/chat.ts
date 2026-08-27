import type { CodeRetriever } from "../retrieval/retriever.js";
import { explainRetrievedContext } from "../retrieval/explainable-search.js";
import { analyzeImpact } from "../tools/impact-analysis.js";
import { metricsCollector } from "../monitoring/observability.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  sources?: any[];
  impactReport?: any;
}

export async function processChatMessage(
  query: string,
  retriever: CodeRetriever,
  history: ChatMessage[] = [],
): Promise<ChatMessage> {
  const trimmed = query.trim();

  // 1. Slash Command: /impact <symbol>
  if (trimmed.startsWith("/impact ")) {
    const symbol = trimmed.replace("/impact ", "").trim();
    try {
      const graph = (retriever as any).graph;
      const report = analyzeImpact(symbol, graph);

      const impactMarkdown = [
        `### ⚡ AST Impact Analysis for \`${report.target.name}\` (${report.target.type})`,
        `📁 **File Path**: \`${report.target.filePath ?? "Unknown"}\``,
        `🛡️ **Risk Level**: **${report.riskLevel}** (${report.riskScore}/100 Risk Score)`,
        ``,
        `#### 📊 Dependency Metrics`,
        `- **Direct Callers**: ${report.directCallersCount}`,
        `- **Total Downstream Dependents**: ${report.totalDependentsCount}`,
        `- **Max Dependency Depth**: ${report.maxDependencyDepth} Hop(s)`,
        ``,
        `#### 🔗 Direct Incoming Callers`,
        ...(report.directDependents.length > 0
          ? report.directDependents.map(
              (d) =>
                `- \`${d.entity.name}\` (${d.entity.type}) — *${d.relationshipType}*`,
            )
          : ["- *No direct incoming call dependencies.*"]),
      ].join("\n");

      return {
        role: "assistant",
        content: impactMarkdown,
        timestamp: new Date().toISOString(),
        impactReport: report,
      };
    } catch (err: any) {
      return {
        role: "assistant",
        content: `⚠️ **Impact Analysis Error**: ${err.message}`,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // 2. Slash Command: /metrics or /health
  if (trimmed === "/metrics" || trimmed === "/health") {
    const metrics = metricsCollector.getMetrics();
    const metricsMarkdown = [
      `### 📊 System Observability & SLA Metrics`,
      `💚 **SLA Health**: **${metrics.healthScore.scorePercentage}% (${metrics.healthScore.status})**`,
      `- **Total Requests**: ${metrics.retrieval.totalRequests}`,
      `- **P50 / P95 / P99 Latency**: ${metrics.retrieval.percentiles.p50Ms}ms / ${metrics.retrieval.percentiles.p95Ms}ms / ${metrics.retrieval.percentiles.p99Ms}ms`,
      `- **Graph Cache Hit Rate**: ${metrics.graphCache.hitRate}`,
      `- **DB Pool Connections**: ${metrics.database.poolIdleConnections} idle / ${metrics.database.poolTotalConnections} total`,
    ].join("\n");

    return {
      role: "assistant",
      content: metricsMarkdown,
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Standard ChatGPT RAG Search & Answer Synthesis
  const retrievedResults = await retriever.retrieve(query, { limit: 5 });
  const explainedResults = retrievedResults.map((res) =>
    explainRetrievedContext(res, query),
  );

  let answerContent = "";

  if (retrievedResults.length === 0) {
    answerContent = `I searched the codebase for **"${query}"**, but couldn't find matching code chunks. Try refining your query terms or checking if the file is excluded by security filters.`;
  } else {
    const topMatch = retrievedResults[0];

    answerContent = [
      `Based on codebase analysis for **"${query}"**:`,
      ``,
      `### 💡 Recommended Symbol: \`${topMatch.name}\``,
      `Located in \`${topMatch.filePath ?? "Source Code"}\` (Lines ${topMatch.startLine}-${topMatch.endLine}):`,
      ``,
      `\`\`\`typescript`,
      topMatch.content ?? "// Code snippet unavailable",
      `\`\`\``,
      ``,
      `**Explainable Relevance Reasoning:**`,
      ...explainedResults[0].explanation.relevanceReasons.map((r) => `- 💡 ${r}`),
    ].join("\n");
  }

  return {
    role: "assistant",
    content: answerContent,
    timestamp: new Date().toISOString(),
    sources: explainedResults,
  };
}
