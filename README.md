# 🐙 Autonomous AI Git Debugging Agent

[![Production CI Pipeline](https://github.com/HarshPariya/ai-chatbot/actions/workflows/ci.yml/badge.svg)](https://github.com/HarshPariya/ai-chatbot/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-22.x%20LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)](https://github.com/pgvector/pgvector)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

> **Enterprise-grade Autonomous Git Debugging & Code Intelligence Platform.**  
> Automatically diagnoses bugs, isolates defect root causes using GraphRAG and AST intelligence, performs 3-way merge conflict resolution, validates patches with senior code review guardrails, and safely coordinates Git operations with protected branch push safeguards.

---

## 📑 Table of Contents

- [Key Capabilities](#-key-capabilities)
- [System Architecture](#-system-architecture)
- [End-to-End Workflows](#-end-to-end-workflows)
  - [1. Connecting Workspaces & Repositories](#1-connecting-workspaces--repositories)
  - [2. Autonomous Issue & Bug Debugging](#2-autonomous-issue--bug-debugging)
  - [3. 3-Way Merge Conflict Resolution](#3-3-way-merge-conflict-resolution)
  - [4. Protected Git Operations & Push Safeguards](#4-protected-git-operations--push-safeguards)
  - [5. Automated Git Bisect & Regression Isolation](#5-automated-git-bisect--regression-isolation)
- [Quick Start](#-quick-start)
- [Configuration & Environment](#-configuration--environment)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Documentation Index](#-documentation-index)
- [Where to Modify Code](#-where-to-modify-code)

---

## 🚀 Key Capabilities

- **Zero-Setup Local Workspace Mounting**: Connect any folder on your laptop (Windows, macOS, or Linux) directly from the dashboard using the built-in native filesystem browser, or connect remote GitHub repositories via Personal Access Token.
- **Autonomous Multi-Agent Reasoning Loop**: Guided by a 28-state deterministic state machine (`TaskPlanner`, `ContextBuilder`, `HypothesisEngine`, `RootCauseAnalyzer`, `FixPlanner`, `CriticAgent`, `PatchEngine`).
- **GraphRAG Code Intelligence**: Combines TypeScript Compiler AST extraction with 384-dimensional semantic feature hashing, dependency graph traversal, and Reciprocal Rank Fusion (RRF) reranking.
- **Semantic 3-Way Merge Conflict Resolver**: Parses `<<<<<<<`, `|||||||`, `=======`, `>>>>>>>` markers, calculates AST impacts, and offers automated or selective resolutions.
- **Strict Git Safety Rails & Push Safeguards**: Classifies 19 Git operations into `safe`, `controlled`, and `dangerous`. Blocks raw `--force` pushes and direct pushes to protected branches (`main`, `master`, `production`, `release`, etc.).
- **Deterministic 1-Click Rollback**: Automatically creates in-memory and disk snapshot backups before modifying any file, enabling instant reversion if tests fail.
- **Real-Time Glassmorphic SPA Dashboard**: Sub-50ms responsive UI with live Server-Sent Events (SSE) log terminal, pipeline step progress, interactive diff viewers, and candidate hypothesis ranking cards.

---

## 🏛️ System Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                          Frontend Layer (SPA)                          │
│     Web Dashboard  •  SSE Stream Consumer  •  Native Folder Browser     │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP REST + SSE
┌───────────────────────────────────▼────────────────────────────────────┐
│                    API Gateway & Middleware Layer                      │
│     Express.js Router  •  JWT Auth & RBAC  •  Path Boundary Sanitizer   │
└───────────┬───────────────────────┬──────────────────────┬─────────────┘
            │                       │                      │
┌───────────▼─────────────┐ ┌───────▼─────────────┐ ┌──────▼─────────────┐
│  Multi-Agent Framework  │ │ Git Engine & Safety │ │ GraphRAG Retrieval │
│ • 28-State Engine       │ │ • 19 Ops Catalog    │ │ • TS AST Parser    │
│ • Task Planner          │ │ • Push Safeguards   │ │ • Dependency Graph │
│ • Hypothesis Engine     │ │ • 3-Way Conflicts   │ │ • 384-Dim Vectors  │
│ • Critic Agent          │ │ • Safe Commits      │ │ • Hybrid RRF Rank  │
│ • Patch Engine          │ │ • Auto Bisect       │ │ • PostgreSQL (opt) │
└─────────────────────────┘ └─────────────────────┘ └────────────────────┘
```

For full architectural diagrams and deep-dive technical specifications, see [docs/architecture.md](docs/architecture.md).

---

## 🔄 End-to-End Workflows

### 1. Connecting Workspaces & Repositories
Users can connect repositories without configuring complex server paths:
- **Folder Browser Modal**: Navigate OS drives (`C:\`, `D:\`, `/`) and click to mount any project workspace.
- **GitHub Integration**: Provide a GitHub token to clone, pull issues, and submit automated pull requests.

### 2. Autonomous Issue & Bug Debugging
1. **Plan Formulation**: `TaskPlanner` classifies the issue and formulates a 5-stage plan (`isolate`, `reproduce`, `diagnose`, `fix`, `verify`).
2. **Context Assembly**: `ContextBuilder` aggregates Git status, diff hunks, recent commit logs, and GraphRAG symbol references.
3. **Hypothesis Generation**: `HypothesisEngine` evaluates possible root causes, scoring each with confidence ratings.
4. **Root Cause Diagnosis**: The engine pinpoints the exact defect lines.
5. **Patch Synthesis**: `FixPlanner` generates unified diffs and assigns risk ratings (`LOW` to `CRITICAL`).
6. **Critic Gate**: `CriticAgent` evaluates code safety (rejecting dangerous shell commands or regressions).
7. **Safe Apply & Verification**: `PatchEngine` creates a snapshot backup, applies the patch, and triggers automated test suites.

### 3. 3-Way Merge Conflict Resolution
- Automatically scans files with unmerged status (`UU`, `AA`, `DD`).
- Decomposes conflicting sections into `ourLines`, `theirLines`, and `baseLines`.
- Generates resolutions via `ours`, `theirs`, or AI semantic merge without breaking code syntax.

### 4. Protected Git Operations & Push Safeguards
- Pre-push validator checks working tree sanity and verifies the local branch is not behind remote.
- Blocks naked `--force` pushes and prevents direct pushes to protected branches (`main`, `master`, `production`).
- Formats commit messages using the Conventional Commits specification.

### 5. Automated Git Bisect & Regression Isolation
- Runs an automated binary search between a known good commit and a bad commit.
- Executes automated test commands at each midpoint, isolating the exact commit and author that introduced the regression.

For detailed sequence diagrams, see [docs/workflow.md](docs/workflow.md).

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v22.x LTS (recommended) or v20.x+
- **Git**: 2.38+ installed and in your PATH
- *(Optional)* Docker Desktop for PostgreSQL + pgvector

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/HarshPariya/ai-chatbot.git
cd ai-chatbot

# Install dependencies
npm ci
```

### 3. Environment Setup
Create a `.env` file in the project root:
```ini
PORT=3000
NODE_ENV=development
GROQ_API_KEY=your_groq_api_key_here
GITHUB_TOKEN=your_optional_github_token_here
DATABASE_URL=postgresql://postgres:password@localhost:5432/ai_chatbot
```

### 4. Run the Platform
```bash
# Development mode with live reload
npm run dev

# Or build and start production server
npm run build
npm start
```
Open **`http://localhost:3000`** in your browser to launch the Web Dashboard.

---

## 🧪 Testing & Quality Assurance

The project includes an enterprise-grade automated test suite:

```bash
# Run complete test suite (all 4 suites: Git Engine, Agent, API, Guardrails)
npm test

# Run modular test suites individually
npm run test:git           # 24 tests: Git operations, branch protection, conflicts
npm run test:agent         # 18 tests: State machine, Critic, Patch Engine
npm run test:api           # 21 tests: Express routes, auth, filesystem browser
npm run test:guardrails    # 22 tests: InputGuard, OutputGuard, resource limits

# Run Ingestion & GraphRAG verification
npm run rag:security-test  # Path traversal and secret filtering
npm run rag:limits-test    # Resource limits and boundary enforcement
npm run rag:graph          # Code graph building and traversal
npm run rag:hybrid         # Hybrid retrieval engine
npm run rag:retrieve       # Multi-query code retriever
npm run rag:integration-test # Full retrieval integration verification

# TypeScript type check & build verification
npx tsc --noEmit
npm run build
```

---

## 📚 Documentation Index

- 🏛️ **[System Architecture](docs/architecture.md)**: Deep technical specification, subsystem architecture, and mermaid diagrams.
- 🔄 **[Workflow & Customization Guide](docs/workflow.md)**: Complete end-to-end user and agent workflows, decision trees, and code modification directory.
- 📡 **[API Specification](docs/api.md)**: REST endpoints, payloads, response schemas, and SSE streaming event specification.
- 🤝 **[Contributing Guide](docs/contributing.md)**: Coding standards, pull request instructions, and CI/CD pipelines.

---

## 🛠️ Where to Modify Code

| Feature Area | Source File | Description |
| :--- | :--- | :--- |
| **Frontend UI Styles** | [`public/styles.css`](public/styles.css) | Glassmorphic design tokens, dark theme colors, animations. |
| **Frontend Dashboard Logic** | [`public/app.js`](public/app.js) | SPA navigation, folder picker modal, SSE log streaming. |
| **Backend REST & SSE API** | [`src/app.ts`](src/app.ts) | Express server routing, middleware, probe endpoints. |
| **Agent State Machine** | [`src/agent/state-machine.ts`](src/agent/state-machine.ts) | 28 execution states, transition event dispatchers. |
| **Critic Safety Gate** | [`src/agent/critic.ts`](src/agent/critic.ts) | Review criteria, risk scoring, dangerous patch rejection. |
| **Git Push Safeguards** | [`src/git/push.ts`](src/git/push.ts) | Protected branch lists, force-push blocking, divergence checks. |
| **Merge Conflict Analyzer** | [`src/git/conflicts.ts`](src/git/conflicts.ts) | 3-way conflict parser and semantic resolution strategies. |
| **Code Graph & AST Indexer** | [`src/ingestion/parser.ts`](src/ingestion/parser.ts) | TypeScript Compiler symbol and entity extraction. |

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
