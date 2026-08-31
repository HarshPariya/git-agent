# Member 2: Agentic AI, LLM & Application Intelligence Layer

## 1. Overview & Architecture Scope

**Member 2** owns the complete **Agentic AI, LLM Orchestration, Security, Guardrails, Autonomous Tool Calling, and Application Intelligence Layer** for the AI Chatbot backend.

This layer sits between external clients (HTTP/API) and the underlying data/retrieval infrastructure, providing intelligent multi-tenant conversation management, multi-step planning, autonomous workspace tool calling (read, write, edit, delete, directory inspection, git status), cost optimization, citation verification, and enterprise-grade cyber-attack defenses.

```
                             [ Client Request ]
                                     │
                     ┌───────────────▼───────────────┐
                     │     HTTP & Security Layer     │
                     │  (Tenant Auth, Rate Limiter)  │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │          Input Guard          │
                     │ (Prompt Injection, Validation)│
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │   Agent Cache & Deduplicator  │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │      Conversation Memory      │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │        Query Rewriter         │
                     │   (Contextual Disambiguation) │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │        Planner Engine         │
                     │  (Direct / Retrieve / Tool)   │
                     └───────────────┬───────────────┘
                                     │
            ┌────────────────────────┼────────────────────────┐
            ▼                        ▼                        ▼
     [ Direct Answer ]      [ Knowledge Retrieval ]     [ Autonomous Tool Loop ]
            │                        │                        │
            │                        ▼                        ├── write_file
            │              (Member 1 Retriever)               ├── read_file
            │                        │                        ├── edit_file
            │                        │                        ├── delete_file
            │                        │                        ├── list_directory
            │                        │                        └── git_status
            └────────────────────────┼────────────────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │    LLM Generation & Router    │
                     │   (Cost Optimizer, Groq SDK)  │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │     Citation & Critic Check   │
                     │  (Grounding & Numeric Verif.) │
                     └───────────────┬───────────────┘
                                     │
                     ┌───────────────▼───────────────┐
                     │         Output Guard          │
                     │   (Secret Redaction, Safety)  │
                     └───────────────┬───────────────┘
                                     │
                             [ Final Response ]
```

---

## 2. Directory & Module Breakdown

All Member 2 source code is modular, type-safe, production-ready, and cleanly decoupled:

| Directory | Core Purpose | Key Components |
| :--- | :--- | :--- |
| **`src/types/`** | Centralized type definitions | `agent.ts`, `llm.ts`, `tools.ts`, `guardrails.ts`, `security.ts`, `evaluation.ts`, `logging.ts`, `services.ts`, `index.ts` |
| **`src/agent/`** | Cognitive agent architecture | `orchestrator.ts`, `planner.ts`, `query-rewriter.ts`, `critic.ts`, `memory.ts`, `cache.ts`, `tool-caller.ts` |
| **`src/llm/`** | LLM client & cost management | `client.ts`, `router.ts`, `cost-optimizer.ts`, `prompts.ts`, `mock-client.ts` |
| **`src/guardrails/`** | Security filters & verification | `input-guard.ts`, `output-guard.ts`, `citation-check.ts` |
| **`src/security/`** | Authentication, RBAC & rate limits | `tenant-context.ts`, `authorization.ts`, `rate-limit.ts` |
| **`src/tools/`** | Autonomous workspace tool suite | `registry.ts`, `write-file.ts`, `read-file.ts`, `edit-file.ts`, `delete-file.ts`, `list-directory.ts`, `git-status.ts`, `retrieve-knowledge.ts` |
| **`src/services/`** | High-level application services | `chat-service.ts`, `citation-service.ts`, `memory-service.ts` |
| **`src/api/`** | Express route handlers | `chat.ts`, `health.ts` |
| **`src/middleware/`** | HTTP middleware | `security.ts`, `request-id.ts` |
| **`src/errors/`** | Standardized error handling | `app-error.ts`, `error-handler.ts` |
| **`src/logging/`** | Structured JSON logging | `logger.ts` |
| **`src/config/`** | Environment configuration | `env.ts`, `limits.ts` |
| **`src/evaluation/`** | Benchmarking & accuracy evaluation | `dataset.ts`, `evaluator.ts`, `metrics.ts` |

---

## 3. Core Subsystems Deep Dive

### 3.1. Agent Orchestration (`src/agent/`)
- **`orchestrator.ts`**: Coordinates the entire lifecycle of a user prompt with strict execution timeouts (`withTimeout`), automatic exponential retries (`withRetry`), response verification, and output sanitization.
- **`planner.ts`**: Strategy pattern matching user queries to appropriate execution pathways (`direct_answer`, `retrieve`, `tool`).
- **`query-rewriter.ts`**: Uses the LLM to rewrite ambiguous multi-turn user follow-up questions into standalone queries using conversation context.
- **`critic.ts`**: Evaluates answer quality against retrieved context, ensuring numeric claims, entity relationships, and facts are strictly grounded.
- **`memory.ts`**: In-memory bounded conversation buffer preventing context overflow per tenant and session.
- **`cache.ts`**: LRU/TTL response cache (`AgentCache`) and concurrent duplicate request joining (`RequestDeduplicator`).
- **`tool-caller.ts`**: Multi-round autonomous function calling loop with execution limits, message bounding, and timeout enforcement.

### 3.2. LLM Engine & Tool Interception (`src/llm/`)
- **`client.ts` & `router.ts`**: High-performance Groq SDK integration with automatic reasoning tag (`<think>`) stripping, native JSON function calling, XML `<tool_call>` parsing, and `failed_generation` error recovery.
- **`cost-optimizer.ts`**: In-memory semantic prompt cache, token budget tracker, rate-per-minute governor, and dynamic context summarizer to minimize API costs.
- **`prompts.ts`**: Structured prompt engineering enforcing truthfulness, strict citation rules, autonomous tool directives, and anti-leak protections.

### 3.3. Guardrails & Safety Pipeline (`src/guardrails/`)
- **`input-guard.ts`**: Rejects prompt injections, jailbreak attempts, delimiter hijacking, and oversized payloads before LLM invocation.
- **`output-guard.ts`**: Inspects generated responses for leaked API keys, credentials, internal system prompts, or restricted tokens.
- **`citation-check.ts`**: Extracts `[source]` or `[source page N]` citation tags from answers and verifies that each cited source exists in the retrieved documents.

### 3.4. Security, Multi-Tenancy & RBAC (`src/security/` & `src/middleware/`)
- **`tenant-context.ts`**: Creates immutable (`Object.freeze`) tenant and user contexts.
- **`authorization.ts`**: Role-Based Access Control (RBAC) supporting granular permissions (`chat:read`, `chat:write`, `documents:read`, `documents:write`).
- **`rate-limit.ts`**: Bounded capacity (`MAX_RATE_LIMITER_ENTRIES = 50,000`) sliding-window rate limiter protecting against OOM/DoS floods.
- **`security.ts` (Middleware)**: Validates incoming identity headers (`x-tenant-id`, `x-user-id`, `x-user-role`), runs rate checks, and authorizes requests.

### 3.5. Workspace Tool Suite (`src/tools/`)
- **`registry.ts`**: Thread-safe tool registry supporting permission enforcement, parameter schema validation, and per-tool timeouts.
- **`write-file.ts`**: Safely creates or overwrites project files with argument aliases (`content`, `text`, `body`, `file_content`).
- **`read-file.ts`**: Reads file contents with line range slicing and sensitive path protections (blocks `.env`, `.pem`, `id_rsa`).
- **`edit-file.ts`**: Replaces specific text blocks with argument aliasing (`old_text` $\rightarrow$ `targetContent`, `new_text` $\rightarrow$ `replacementContent`).
- **`delete-file.ts`**: Deletes non-critical files while protecting root directories, configuration, and source files.
- **`list-directory.ts`**: Traverses project folders with recursion limits and hidden/node_modules exclusions.
- **`git-status.ts`**: Inspects repository status, branches, or recent commit logs safely via `git`.
- **`retrieve-knowledge.ts`**: Standardized knowledge tool wrapping the external retrieval interface.

### 3.6. Evaluation & Metrics Suite (`src/evaluation/`)
- **`dataset.ts`**: Golden benchmark test cases across direct questions, knowledge retrieval, and tool executions.
- **`evaluator.ts`**: Automated benchmark runner comparing actual execution results against expected targets.
- **`metrics.ts`**: Calculates pass rate, retrieval accuracy, citation precision, citation recall, and Citation F1 score.

---

## 4. Integration Boundary (Member 1 Interface)

Member 2 communicates with Member 1's GraphRAG / Retrieval layer **exclusively** through the stable interface defined in `src/retrieval/types.ts`:

```typescript
export interface RetrievalRequest {
  readonly query: string;
  readonly tenantId?: string;
  readonly limit?: number;
}

export interface RetrievalResult {
  readonly id: string;
  readonly content: string;
  readonly source: string;
  readonly score: number;
  readonly page?: number;
}

export interface Retriever {
  search(request: RetrievalRequest): Promise<readonly RetrievalResult[]>;
}
```

**Boundary Rules:**
1. Member 2 **never** imports database drivers, SQL, graph algorithms, or ingestion code.
2. Member 1 code is treated as an external service matching the `Retriever` contract.

---

## 5. Security & Cyber-Defense Matrix

| Vector | Threat | Member 2 Defense |
| :--- | :--- | :--- |
| **Input Layer** | Prompt Injection / Jailbreaks | Multi-pattern regex scanner + length limits (`src/guardrails/input-guard.ts`) |
| **Output Layer** | Secret / Key Exfiltration | Regex redaction for credentials, API keys, system prompts (`src/guardrails/output-guard.ts`) |
| **Data Layer** | Cross-Tenant Data Leaks | Strict isolation via frozen `TenantContext` in memory, cache, and rate limiters |
| **Access Layer** | Privilege Escalation | RBAC matrix checks (`src/security/authorization.ts`) |
| **Infra Layer** | Denial of Service (DoS / OOM) | Bounded rate limiter (50k ceiling) + request deduplication + token budgeting |
| **Execution** | Unresponsive External Services | Strict per-operation timeouts with guaranteed timer cleanup in `finally` blocks |
| **File System** | Path Traversal / Poisoning | Path sanitization, null byte rejection, and workspace root jail (`src/tools/*`) |
| **Information** | Sensitive Stack Trace Leaks | Sanitized error responses with internal logging (`src/errors/error-handler.ts`) |

---

## 6. Build & Test Verification

Member 2 is verified independently with zero external infrastructure dependencies:

```bash
# Compile Member 2 TypeScript
npm run build:m2

# Run Member 2 Test Suite (96/96 passing tests)
npm run test:m2
```
