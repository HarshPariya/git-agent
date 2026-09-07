# 🐙 Autonomous AI Git Debugging Agent

Production-ready, enterprise-grade Autonomous AI Git Debugging Agent that connects with GitHub and local Git repositories. It analyzes repositories using GraphRAG and AST intelligence, performs automated root-cause diagnostics, generates hypotheses, validates fix patches, detects CI/CD issues, and resolves merge conflicts.

---

## 🚀 Key Features

- **Multi-Source Repository Connection**: Connect via GitHub Personal Access Token or directly browse and mount local folders and workspaces.
- **Automated Root Cause Diagnosis**: Hypothesize, test, and isolate bugs with structured step-by-step debug sessions (`isolate`, `reproduce`, `diagnose`, `fix`, `verify`, `observe`).
- **GraphRAG & AST Semantic Retrieval**: Hybrid code search combining TypeScript Compiler AST parsing, PostgreSQL + pgvector embeddings, and dependency graph traversal.
- **CI/CD Failure Analysis**: Diagnose build, test, and lint failures with actionable remedy steps and diff recommendations.
- **Merge Conflict Resolution**: Semantic 3-way conflict analysis with deterministic AST impact assessment.
- **Security & Sandboxing**: Strict repository access isolation, PII scrubbing, rate limiting, and RBAC authorization.
- **Modern Glassmorphic UI**: High-contrast, clean professional dashboard with dark theme, real-time repository browser, step-by-step pipeline visualizer, and live patch view.

---

## ⚡ Quick Start

### 1. Prerequisites
- Node.js 20+
- (Optional) Docker Desktop for PostgreSQL + pgvector database

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy `.env.example` to `.env`:
```ini
PORT=3000
NODE_ENV=development
GROQ_API_KEY=your_groq_api_key_here
GITHUB_TOKEN=your_optional_github_token_here
DATABASE_URL=postgresql://postgres:password@localhost:5433/ai_chatbot
```

### 4. Build and Run
```bash
# Build TypeScript
npm run build

# Start Production Server
npm run start

# Or Development Mode with Live Reload
npm run dev
```

Open your browser at `http://localhost:3000` to launch the debugging dashboard.

---

## 🧪 Verification & Benchmarks

```bash
# Verify TypeScript Build
npm run build

# Run GraphRAG Integration Suite
npm run rag:integration-test

# Run Retrieval Ablation Benchmark
npm run rag:ablation

# Run AST Impact Analysis Tool Verification
npm run tool:impact-analysis
```

---

## 📂 Architecture Overview

- `src/agent/`: Autonomous debugging orchestrator, state machine, hypothesis engine, root cause analyzer.
- `src/git/`: Git command engine, conflict analyzer, diff generator, and patch validator.
- `src/github/`: GitHub REST API client, webhook handler, PR creator, and CI status monitor.
- `src/graph/`: AST code knowledge graph builder, graph cache, and traversal engine.
- `src/ingestion/`: TypeScript Compiler AST parser, chunker, and vector indexer.
- `src/retrieval/`: Hybrid GraphRAG retriever, vector search, explainable search, and reranker.
- `src/repositories/`: In-memory and persistent repository state management.
- `src/security/`: Role-based authorization, rate limiting, and tenant isolation.
- `public/`: Production Web Dashboard with responsive UI, local folder picker, and real-time debug pipeline.
