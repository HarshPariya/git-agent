# 🤖 GraphRAG AI Chatbot

Production-ready, hardened GraphRAG AI Chatbot with TypeScript Compiler API AST Parsing, PostgreSQL + pgvector vector search, dynamic multi-agent orchestration, AST impact analysis, and multi-tenant document RAG.

---

## 📚 Documentation Quick Links

- [**`architecture.md`**](file:///d:/Agentic%20AI%20Codage%20Habitation%20Project/ai-chatbot/architecture.md): Complete System Design, Component Architecture, Data Flow Diagrams, Entity-Relationship Models, and API Specifications.
- [**`RETRIEVAL_GRAPHRAG.md`**](file:///d:/Agentic%20AI%20Codage%20Habitation%20Project/ai-chatbot/RETRIEVAL_GRAPHRAG.md): Production Readiness Report, Hardening Verification, and Retrieval Ablation Benchmark Matrix.

---

## ⚡ Quick Start

### 1. Prerequisites & Services
Ensure Docker Desktop is running, then start the PostgreSQL + pgvector database container:
```bash
docker-compose up -d
```

### 2. Environment Setup
Create a `.env` file based on `.env.example`:
```ini
PORT=3000
NODE_ENV=development
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_DB=ai_chatbot
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key
```

### 3. Run Migrations & Build
```bash
npm install
npm run db:migrate
npm run build
```

### 4. Start Server
```bash
# Development Mode (Hot Reload)
npm run dev

# Production Mode
npm run start
```

---

## 🧪 Verification & Benchmarks

```bash
# Run Full Integration Test Suite
npm run rag:integration-test

# Run Retrieval Ablation Benchmark Matrix
npm run rag:ablation

# Run AST Impact Analysis Tool Verification
npm run tool:impact-analysis
```
