import type { RetrievedContext } from "./retriever.js";

export interface ImpactAnalysisReport { targetFile?: string; affectedFiles: string[]; depth?: number; }

export interface ExplainableRetrievedContext extends RetrievedContext {
  explanation: { matchSummary: string; structuralImportance: string; relevanceReasons: string[] };
  impactReport?: ImpactAnalysisReport;
}

export function explainRetrievedContext(context: RetrievedContext, query: string): ExplainableRetrievedContext {
  const reasons: string[] = [];
  if (context.sources.includes("vector") && context.sources.includes("graph")) reasons.push("Hybrid agreement: High similarity vector embedding + AST Graph structural match");
  else if (context.sources.includes("vector")) reasons.push("Semantic similarity vector embedding match");
  else if (context.sources.includes("graph")) reasons.push("AST Graph traversal neighbor match");
  if (context.rerankScore && context.rerankScore > 0.5) reasons.push("Deterministic code signal bonus (identifier token overlap & type bonus)");
  if (context.name.toLowerCase().includes(query.toLowerCase())) reasons.push(`Exact identifier substring match for query token '${query}'`);
  return {
    ...context,
    explanation: { matchSummary: `Rank #${context.rank}: ${context.name} (${context.type ?? "chunk"}) — Score: ${context.score.toFixed(4)}`, structuralImportance: `Vector Score: ${context.vectorScore.toFixed(4)} | Graph Score: ${context.graphScore.toFixed(4)}`, relevanceReasons: reasons },
  };
}
