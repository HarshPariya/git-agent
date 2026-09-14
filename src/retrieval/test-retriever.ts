import { CodeRetriever } from "./retriever.js";
import { closeDatabase } from "../db/mongodb.js";

const formatResult = (result: {
  rank: number;
  name: string;
  rerankScore?: number;
  score: number;
  vectorScore: number;
  graphScore: number;
  sources: string[];
  filePath?: string;
  startLine?: number;
  endLine?: number;
}): string => {
  const rerank = result.rerankScore !== undefined ? `\n   Rerank: ${result.rerankScore.toFixed(4)}` : "";
  const file = result.filePath ? `\n   File: ${result.filePath}` : "";
  const lines =
    result.startLine !== undefined && result.endLine !== undefined
      ? `\n   Lines: ${result.startLine}-${result.endLine}`
      : "";

  return (
    `${result.rank}. ${result.name}${rerank}\n` +
    `   Hybrid Score: ${result.score.toFixed(4)}\n` +
    `   Vector Score: ${result.vectorScore.toFixed(4)}\n` +
    `   Graph Score: ${result.graphScore.toFixed(4)}\n` +
    `   Sources: ${result.sources.join(" + ")}` +
    file +
    lines +
    "\n"
  );
};

const main = async (): Promise<void> => {
  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();

  const stats = retriever.getStats();
  console.warn(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVER STATS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.warn(
    `Files: ${stats.files}\nChunks: ${stats.chunks}\nGraph nodes: ${stats.graphNodes}\nGraph edges: ${stats.graphEdges}`,
  );

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
  console.warn(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQUERY: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const results = await retriever.retrieve(query, { limit: 8 });
  for (const result of results) {
    console.warn(`${formatResult(result)}\n`);
  }
};

main()
  .catch((error: unknown) => {
    console.error("Retriever test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
