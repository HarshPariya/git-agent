import { CodeRetriever } from "./retriever.js";
import { closeDatabase } from "../db/postgres.js";

async function main() {
  const retriever = new CodeRetriever(process.cwd());
  await retriever.initialize();
  const stats = retriever.getStats();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nRETRIEVER STATS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Files: ${stats.files}\nChunks: ${stats.chunks}\nGraph nodes: ${stats.graphNodes}\nGraph edges: ${stats.graphEdges}`);

  const query = process.argv.slice(2).join(" ") || "Where is normalizeId used?";
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nQUERY: "${query}"\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const results = await retriever.retrieve(query, { limit: 8 });
  for (const result of results) {
    let info = `${result.rank}. ${result.name}`;
    if (result.rerankScore !== undefined) info += `\n   Rerank: ${result.rerankScore.toFixed(4)}`;
    info += `\n   Hybrid Score: ${result.score.toFixed(4)}\n   Vector Score: ${result.vectorScore.toFixed(4)}\n   Graph Score: ${result.graphScore.toFixed(4)}\n   Sources: ${result.sources.join(" + ")}`;
    if (result.filePath) info += `\n   File: ${result.filePath}`;
    if (result.startLine !== undefined && result.endLine !== undefined) info += `\n   Lines: ${result.startLine}-${result.endLine}`;
    console.log(`${info}\n`);
  }
}

main().catch((error) => { console.error("Retriever test failed:"); console.error(error); process.exitCode = 1; }).finally(async () => { await closeDatabase(); });
