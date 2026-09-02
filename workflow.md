# 🔄 Comprehensive System & Development Workflow Documentation

This document outlines the end-to-end operational, architectural, data processing, multi-agent execution, and verification workflows for the **GraphRAG AI Chatbot System**.

---

## 📌 Workflow Overview & Sequence Map

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User / Client
    participant API as 🌐 Express API Gateway
    participant Router as 🧭 Intent Router
    participant Agent as 🤖 Agent Orchestrator
    participant RAG as 🔍 Hybrid RAG Engine
    participant DB as 🗄️ PostgreSQL + pgvector
    participant Tools as 🛠️ Workspace Tools Engine

    User->>API: POST /chat { message, sessionId, tenantId }
    API->>API: Security Middleware & Rate Limiter Check
    API->>Router: routeQuery(message)
    Router-->>API: Return Route (code | document | mixed | general | system)
    API->>Agent: agent.run({ question, retrievalMode })
    
    alt Mode == "code" or "mixed" (Knowledge / Search Request)
        Agent->>RAG: search({ query, mode })
        RAG->>DB: Vector Search (HNSW Cosine ops) & Graph Traversal (AST BFS)
        DB-->>RAG: Raw Chunks & Node Graph
        RAG->>RAG: Reciprocal Rank Fusion (RRF) + Deterministic Code Reranker
        RAG-->>Agent: Top-K Reranked Context + Explanations
    else Mode == "tool" (File Creation / Manipulation Request)
        Agent->>Tools: executeTool(list_directory / read_file / write_file)
        Tools->>Tools: Blast Radius & Impact Analysis (up to 4-hop call graph)
        Tools-->>Agent: Execution Result / Output Snippets
    end

    Agent->>Agent: Citation Verification & Quality Critic Audit
    Agent-->>API: Streamed / Formatted Markdown Response
    API-->>User: HTTP 200 JSON Response { message, sources, pipeline }
```

---

## 1. Repository & AST Ingestion Workflow

This workflow executes on server startup or when triggered via indexing scripts (`npm run rag:indexer-test`).

```mermaid
flowchart TD
    Start([1. Trigger Ingestion]) --> ParseRepo[2. Parse Repository Files\nsrc/ingestion/parser.ts]
    ParseRepo --> StripSecrets[3. Security & Secret Filter\nFilter .env, API keys & tokens]
    StripSecrets --> Chunking[4. Syntactic Chunking Engine\nsrc/ingestion/chunker.ts]
    
    ParseRepo --> ASTParse[5. TS Compiler API AST Parser\nsrc/ingestion/ast-parser.ts]
    ASTParse --> EntityExtract[6. Extract Entities: Nodes\nFunctions, Classes, Interfaces, Types]
    ASTParse --> RelExtract[7. Extract Relationships: Edges\nCalls, Imports, Extends, Implements]
    
    EntityExtract --> BuildGraph[8. Construct Code Knowledge Graph\nsrc/graph/graph-builder.ts]
    RelExtract --> BuildGraph
    BuildGraph --> CacheGraph[9. Save Graph to Disk Cache\n.cache/graphrag/graph.json]

    Chunking --> GenerateEmbeddings[10. Batch Embedding Generator\n384-dimensional vectors]
    GenerateEmbeddings --> UpsertDB[(11. PostgreSQL + pgvector\nUpsert Chunks & Update HNSW Index)]
    UpsertDB --> CleanupStale[12. Delete Stale / Removed File Chunks]
    CleanupStale --> Complete([Ingestion Complete & Ready])
```

### Key Stages:
1. **File Parsing**: Scans repository source files (`.ts`, `.js`, `.json`, `.md`).
2. **Secret Scrubbing**: Strips environment variables, `.env` entries, and credentials.
3. **AST Entity & Edge Extraction**: Uses TypeScript Compiler API to map full symbol call trees and dependency graphs without full compilation overhead.
4. **pgvector Storage**: Embeds code chunks and stores them in PostgreSQL with `VECTOR(384)` and HNSW cosine distance indexing (`SET LOCAL hnsw.ef_search = 100`).

---

## 2. Request Routing & Intent Classification Workflow

Every incoming HTTP request goes through deterministic classification before triggering LLM generation:

```mermaid
flowchart TD
    Req[Incoming Message] --> CheckSys{Matches System / Metrics Pattern?}
    CheckSys -->|Yes| SysMode[Route: system\nReturn Promethus & Observability Stats]
    CheckSys -->|No| CheckCode{Matches Code Keywords?\narchitecture, file, src/, class, create, write}
    
    CheckCode -->|Yes| CheckDocs{Has Uploaded Docs?}
    CheckDocs -->|Yes| MixedMode[Route: mixed\nSearch both Repository Code & Uploaded Documents]
    CheckDocs -->|No| CodeMode[Route: code\nSearch Code Chunks & AST Graph]

    CheckCode -->|No| CheckDocKw{Matches Document Keywords?\npdf, docx, policy, spec}
    CheckDocKw -->|Yes| DocMode[Route: document\nSearch Uploaded Document Chunks]
    CheckDocKw -->|No| GenMode[Route: general\nDirect LLM Generation / General Query]
```

---

## 3. Autonomous Multi-Agent Loop Workflow

```mermaid
flowchart TD
    Init[Query Received] --> Mem[Fetch Session Conversation History]
    Mem --> Rewrite[Query Rewriter / HyDE Expansion\nsrc/agent/query-rewriter.ts]
    Rewrite --> Plan[Task Decomposition Planner\nsrc/agent/planner.ts]
    
    Plan --> ActionType{Plan Action}
    
    ActionType -->|action == tool| ToolLoop[Run Tool Calling Loop\nsrc/agent/tool-caller.ts]
    ToolLoop --> ToolExec[Execute Tool: read_file / write_file / edit_file / list_directory]
    ToolExec --> ToolResult[Synthesize Tool Output into Response]
    
    ActionType -->|action == retrieve| RAGLoop[Execute Hybrid RAG Search]
    RAGLoop --> VecSearch[Vector Search pgvector HNSW]
    RAGLoop --> GraphSearch[Graph Traversal BFS AST Nodes]
    VecSearch --> RRF[Reciprocal Rank Fusion RRF]
    GraphSearch --> RRF
    RRF --> Rerank[Deterministic Code Signal Reranker]
    Rerank --> GenAnswer[Generate Answer with Grounded Evidence]

    ToolResult --> CriticCheck[Run Quality Critic & Citation Verification]
    GenAnswer --> CriticCheck
    
    CriticCheck -->|Passed| ReturnOutput[Deliver Final Markdown Response]
    CriticCheck -->|Failed| RefineAnswer[Refine Answer & Re-Evaluate]
    RefineAnswer --> ReturnOutput
```

---

## 4. AST Impact Analysis & Code Mutation Safety Workflow

Before making destructive or structural changes to code files, the system executes static blast-radius impact analysis:

```mermaid
flowchart TD
    Request[User Request to Edit / Refactor Symbol] --> ImpactTool[Run Impact Analysis Engine\nsrc/tools/impact-analysis.ts]
    ImpactTool --> FindNode[Locate Target Symbol in Code Knowledge Graph]
    FindNode --> BFSTraverse[Traverse Incoming Callers & Importers up to 4 Hops]
    BFSTraverse --> ComputeRisk{Calculate Affected Count & Max Depth}
    
    ComputeRisk -->|Hop Depth >= 3 OR Callers > 10| CriticalRisk[Risk: CRITICAL\nFlag High Risk & List Affected Callers]
    ComputeRisk -->|Hop Depth == 2 OR Callers > 5| HighRisk[Risk: HIGH\nList Direct Callers]
    ComputeRisk -->|Hop Depth == 1 OR Callers > 1| MedRisk[Risk: MEDIUM\nList Caller Files]
    ComputeRisk -->|Callers == 0| LowRisk[Risk: LOW\nSafe to Edit]

    CriticalRisk --> SafetyReport[Generate Impact Assessment Report]
    HighRisk --> SafetyReport
    MedRisk --> SafetyReport
    LowRisk --> SafetyReport
    
    SafetyReport --> PerformEdit[Execute edit_file / write_file Tool Operation]
```

---

## 5. Multi-Tenant Document Upload Workflow

```mermaid
flowchart TD
    UploadReq[POST /api/documents/upload] --> AuthCheck[Verify Tenant ID & User ID Scope]
    AuthCheck --> ParseDoc[Multi-Format Document Parser\nsrc/ingestion/document-parser.ts]
    
    ParseDoc --> MimeCheck{File Format?}
    MimeCheck -->|PDF| PdfParse[pdf-parse / pdfjs-dist / OCR Tesseract]
    MimeCheck -->|DOCX| DocxParse[Mammoth Parser]
    MimeCheck -->|TXT / MD| TextParse[Plain Text Parser]

    PdfParse --> DocChunker[Document Chunker\nsrc/ingestion/document-chunker.ts]
    DocxParse --> DocChunker
    TextParse --> DocChunker
    
    DocChunker --> EmbedDoc[Generate Vector Embeddings 384-d]
    EmbedDoc --> StoreDoc[(Store in documents & document_chunks tables\nwith ON DELETE CASCADE & HNSW index)]
    StoreDoc --> UploadComplete[Return HTTP 200 { documentId, status: 'indexed' }]
```

---

## 6. Verification, Testing & Pipeline Commands

```powershell
# 1. Compile TypeScript Codebase
npm run build

# 2. Apply SQL Database Migrations
npm run db:migrate

# 3. Verify Database Pool & Resilience
npm run db:test

# 4. Verify Database Backup & Restore
npm run db:backup-test

# 5. Execute Security, Path Traversal & Secret Scrubbing Test
npm run rag:security-test

# 6. Test Batch Vector Embedding Engine
npm run rag:embed-test

# 7. Test Incremental Repository Indexer
npm run rag:indexer-test

# 8. Test System Input Guardrails & Token Limits
npm run rag:limits-test

# 9. Verify AST Blast Radius Impact Analysis
npm run tool:impact-analysis

# 10. Run End-to-End System Integration Test
npm run rag:integration-test

# 11. Run Retrieval Ablation Benchmark Matrix
npm run rag:ablation
```
