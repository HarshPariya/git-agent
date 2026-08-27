import express from "express";
import cors from "cors";
import path from "node:path";
import { CodeRetriever } from "./retrieval/retriever.js";
import { explainRetrievedContext } from "./retrieval/explainable-search.js";
import { analyzeImpact } from "./tools/impact-analysis.js";
import { metricsCollector } from "./monitoring/observability.js";
import { getDatabaseHealth, closeDatabase } from "./db/postgres.js";
import { processChatMessage } from "./api/chat.js";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(express.json());

let retriever: CodeRetriever | undefined;

// 1. Health & Readiness Endpoints
app.get("/health", async (req, res) => {
  const dbHealth = await getDatabaseHealth();
  res.json({
    status: dbHealth.status === "healthy" ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    database: dbHealth,
  });
});

app.get("/ready", (req, res) => {
  res.json({
    ready: true,
    repository: "ai-chatbot",
    timestamp: new Date().toISOString(),
  });
});

// 2. Interactive AI Chatbot Endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message string is required." });
    }

    if (!retriever) {
      return res.status(503).json({ error: "Retriever engine initializing." });
    }

    const response = await processChatMessage(message, retriever, history);
    res.json(response);
  } catch (err: any) {
    console.error("API /api/chat error:", err);
    res.status(500).json({ error: err.message || "Failed to process chat message." });
  }
});

// 3. Retrieval Search API
app.post("/api/search", async (req, res) => {
  try {
    const { query, limit, vectorWeight, graphWeight, graphMaxDepth } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Query parameter string is required." });
    }

    if (!retriever) {
      return res.status(503).json({ error: "Retriever engine initializing." });
    }

    const results = await retriever.retrieve(query, {
      limit: limit ? parseInt(limit, 10) : 10,
      vectorWeight: vectorWeight ? parseFloat(vectorWeight) : undefined,
      graphWeight: graphWeight ? parseFloat(graphWeight) : undefined,
      graphMaxDepth: graphMaxDepth ? parseInt(graphMaxDepth, 10) : undefined,
    });

    const explained = results.map((resItem) =>
      explainRetrievedContext(resItem, query),
    );

    res.json({
      query,
      count: results.length,
      results: explained,
    });
  } catch (err: any) {
    console.error("API /api/search error:", err);
    res.status(500).json({ error: err.message || "Failed to execute retrieval." });
  }
});

// 4. Impact Analysis API
app.post("/api/impact", (req, res) => {
  try {
    const { target } = req.body;
    if (!target || typeof target !== "string") {
      return res.status(400).json({ error: "Target symbol name string is required." });
    }

    if (!retriever) {
      return res.status(503).json({ error: "Retriever engine initializing." });
    }

    const graph = (retriever as any).graph;
    if (!graph) {
      return res.status(500).json({ error: "Code graph not ready." });
    }

    const report = analyzeImpact(target, graph);
    res.json(report);
  } catch (err: any) {
    console.error("API /api/impact error:", err);
    res.status(400).json({ error: err.message || "Impact analysis failed." });
  }
});

// 5. Metrics & Prometheus APIs
app.get("/api/metrics", (req, res) => {
  const metrics = metricsCollector.getMetrics();
  res.json(metrics);
});

app.get("/metrics", (req, res) => {
  const prometheusText = metricsCollector.getPrometheusFormat();
  res.setHeader("Content-Type", "text/plain");
  res.send(prometheusText);
});

// 6. Repository Stats API
app.get("/api/stats", (req, res) => {
  if (!retriever) {
    return res.status(503).json({ error: "Retriever initializing." });
  }
  res.json(retriever.getStats());
});

// Serve Static Frontend Assets (After API Routes)
app.use(express.static(path.join(process.cwd(), "public")));

async function startServer() {
  console.log("🚀 Initializing GraphRAG Engine for Web Interface...");
  retriever = new CodeRetriever(process.cwd(), "ai-chatbot");
  await retriever.initialize();

  const server = app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🌐 GraphRAG Intelligence Web Application Active!`);
    console.log(`👉 UI Dashboard: http://localhost:${PORT}`);
    console.log(`==================================================\n`);
  });

  process.on("SIGINT", async () => {
    console.log("\n🔌 Shutting down GraphRAG web server...");
    server.close();
    await closeDatabase();
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
