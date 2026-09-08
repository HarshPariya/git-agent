import type { RetrievedContext } from "./retriever.js";

export interface ImpactAnalysisReport {
  targetFile?: string;
  affectedFiles: string[];
  depth?: number;
}

export interface ExplainableRetrievedContext extends RetrievedContext {
  explanation: {
    matchSummary: string;
    structuralImportance: string;
    relevanceReasons: string[];
  };
  impactReport?: ImpactAnalysisReport;
}

const SOURCE_EXPLANATIONS: Record<string, string> = {
  "vector+graph": "Hybrid agreement: High similarity vector embedding + AST Graph structural match",
  vector: "Semantic similarity vector embedding match",
  graph: "AST Graph traversal neighbor match",
};

export const explainRetrievedContext = (
  context: RetrievedContext,
  query: string
): ExplainableRetrievedContext => {
  const sourceKey = context.sources.includes("vector") && context.sources.includes("graph")
    ? "vector+graph"
    : context.sources.includes("vector")
      ? "vector"
      : "graph";

  const reasons: string[] = [
    SOURCE_EXPLANATIONS[sourceKey] ?? "Unknown source match",
    ...(context.rerankScore && context.rerankScore > 0.5
      ? ["Deterministic code signal bonus (identifier token overlap & type bonus)"]
      : []),
    ...(context.name.toLowerCase().includes(query.toLowerCase())
      ? [`Exact identifier substring match for query token '${query}'`]
      : []),
  ];

  return {
    ...context,
    explanation: {
      matchSummary: `Rank #${context.rank}: ${context.name} (${context.type ?? "chunk"}) — Score: ${context.score.toFixed(4)}`,
      structuralImportance: `Vector Score: ${context.vectorScore.toFixed(4)} | Graph Score: ${context.graphScore.toFixed(4)}`,
      relevanceReasons: reasons,
    },
  };
};
