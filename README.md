# 🐙 Autonomous AI Git Debugging Agent

[![Production CI Pipeline](https://github.com/HarshPariya/ai-chatbot/actions/workflows/ci.yml/badge.svg)](https://github.com/HarshPariya/ai-chatbot/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-22.x%20LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20%2B%20pgvector-336791.svg)](https://github.com/pgvector/pgvector)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

> **Enterprise-grade Autonomous Git Debugging & Code Intelligence Platform.**  
> Automatically diagnoses bugs, isolates defect root causes using GraphRAG and AST intelligence, performs 3-way merge conflict resolution, validates patches with senior code review guardrails, and safely coordinates Git operations with protected branch push safeguards.

---

## 📖 Quick Documentation Links (1-Click Access)

Click any link below to directly open the complete documentation guide:

| Document | 1-Click Link | Description |
| :--- | :--- | :--- |
| 🏛️ **System Architecture** | [**`docs/architecture.md`**](docs/architecture.md) | Technical architecture, 9 modular frontend views, Git engine, GraphRAG, and test pyramid |
| 🔄 **Workflows & Customization** | [**`docs/workflow.md`**](docs/workflow.md) | End-to-end Git Desktop flow, commit plans, PR lifecycle, and 25-row code modification directory |
| 📡 **API Specification** | [**`docs/api.md`**](docs/api.md) | Complete REST endpoints, request/response schemas, SSE stream events, and error codes |
| 🤝 **Contributing Guide** | [**`docs/contributing.md`**](docs/contributing.md) | Code standards, branching model, CI/CD pipeline, and modular test runner commands |

---

## 📑 Table of Contents

- [📖 Quick Documentation Links](#-quick-documentation-links-1-click-access)
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

- **Dual-Workspace Architecture**:
  - **Workspace A (AI Debugging)**: 28-state live agent loop with quick modes (`DEBUG BUG`, `DEBUG ISSUE`, `DEBUG PR`, `DEBUG CI`, `DEBUG REGRESSION`, `RESOLVE CONFLICT`), ranked hypotheses, root-cause diagnosis, unified diffs, and 1-click rollback snapshots.
  - **Workspace B (Git Desktop)**: Comprehensive working tree changes inspector (staged, unstaged, untracked, risk classification), Continuous Diff Viewer, `AI ANALYZE CHANGES` (semantic clustering via Groq LLM + GraphRAG), `AI COMMIT PLAN` (Conventional Commits), one-click `AI COMMIT ALL` (sequential atomic group commits with verified SHAs; never blind `git add .`), `FETCH`, `PULL`, `SYNC`, `PUSH` (with Push Preview Modal & branch safeguards), and end-to-end `AI SHIP`.
- **9 Distinct Modular Frontend Views**:
  - `Dashboard`: System health, active repo metrics, and recent commit activity.
  - `Repositories`: Workspace manager with Windows Native Dialog (`FolderBrowserDialog`), in-app filesystem browser, and GitHub token connector.
  - `AI Debugging`: Autonomous 28-state reasoning console with real-time SSE stream.
  - `Git Desktop`: First-class visual Git operations center with branch switcher modal, continuous diff viewer, commit plan organizer, and post-push executive summary.
  - `Pull Requests`: PR management hub with branch target selection, diff view, and 3 merge strategies (`merge`, `squash`, `rebase`).
  - `Issues`: Issue triage dashboard with one-click "Debug Issue" autonomous trigger.
  - `Conflicts`: 4-Way Conflict Center (`BASE | OURS | THEIRS | AI RESOLUTION`) with automated test validation.
  - `History`: Visual commit timeline with author badges, commit messages, and diff modals.
  - `Settings`: LLM selection (Groq LLaMA 3.3 70B), API tokens, theme toggle, and system cache controls.
- **Windows Native OS Integration**: Built-in PowerShell .NET `[System.Windows.Forms.FolderBrowserDialog]` integration via `POST /api/fs/pick-native-dialog` and host OS File Explorer reveal via `POST /api/fs/open-in-os`.
- **4-Way Conflict Center**: Real-time side-by-side inspection (`BASE | OURS | THEIRS | AI RESOLUTION`) with syntax-safe semantic merge and automated test execution.
- **Zero-Setup Local Workspace Mounting**: Connect any folder on your laptop (Windows, macOS, or Linux) directly from the dashboard using the built-in native filesystem browser, or connect remote GitHub repositories via Personal Access Token.
- **GraphRAG Code Intelligence**: Combines TypeScript Compiler AST extraction with 384-dimensional semantic feature hashing, dependency graph traversal, and Reciprocal Rank Fusion (RRF) reranking.
- **Strict Git Safety Rails & Push Safeguards**: Classifies 19 Git operations into `safe`, `controlled`, and `dangerous`. Direct `execFile("git")` execution prevents Windows shell `%h` formatting corruption. Blocks raw `--force` pushes and direct pushes to protected branches (`main`, `master`, `production`, `release`, `develop`, `staging`).
- **Deterministic 1-Click Rollback**: Automatically creates in-memory and disk snapshot backups before modifying any file, enabling instant reversion if tests fail.
- **Professional Slate Developer-Tool UI**: Crisp, distraction-free modern interface with live Server-Sent Events (SSE) terminal, interactive change tables, and push safeguard modals.

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

The project includes an enterprise-grade automated test suite with **6 test suites and 139 passing assertions**:

```bash
# Run complete test suite (all 6 suites: Git Engine, Agent, API, Guardrails, Git Desktop, E2E Workflow)
npm test

# Run modular test suites individually
npm run test:git           # 24 tests: Git operations, branch protection, conflicts
npm run test:agent         # 18 tests: State machine, Critic, Patch Engine
npm run test:api           # 21 tests: Express routes, auth, filesystem browser
npm run test:guardrails    # 22 tests: InputGuard, OutputGuard, resource limits
npm run test:desktop       # 38 tests: File change detection, semantic clustering, atomic commits
npm run test:e2e-desktop   # 16 assertions: End-to-end bare origin push, commit plan, branch switching

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

The complete documentation suite consists of 4 focused guides:

| Document | Direct 1-Click Link | Key Topics Covered |
| :--- | :--- | :--- |
| 🏛️ **System Architecture** | [**`docs/architecture.md`**](docs/architecture.md) | High-level system overview, 9 modular frontend views (`state.js`, `components/`, `views/`), agentic multi-agent framework, cross-platform Git engine with `execFile`, Windows PowerShell `FolderBrowserDialog`, GraphRAG retrieval, security guardrails, and 6-suite test pyramid (139 assertions). |
| 🔄 **Workflow & Customization** | [**`docs/workflow.md`**](docs/workflow.md) | 8 detailed workflows: Workspace connection, Autonomous Bug Debugging loop, 3-Way Conflict Resolution, Git Desktop & AI Commit Planning, Pull Request Lifecycle & Branch Management, GitHub Issue Triage, Controlled Git Operations & Push Safeguards, Automated Git Bisect, and a 25-row code modification directory. |
| 📡 **API Specification** | [**`docs/api.md`**](docs/api.md) | Endpoints reference: System probes, Authentication, Filesystem & Windows Native Dialog (`/api/fs/*`), Git Desktop operations (`/api/git/*`), Autonomous Debugging & SSE streaming (`/api/debug/*`), Pull Requests & GitHub issues (`/api/pr/*`), and GraphRAG search. |
| 🤝 **Contributing Guide** | [**`docs/contributing.md`**](docs/contributing.md) | Development environment setup, TypeScript strict guidelines, Conventional Commits standard, testing commands for all 6 modular test suites, GitHub Actions CI matrix, and branching strategy. |

---

## 🛠️ Where to Modify Code

| Feature Area | Source File | Description |
| :--- | :--- | :--- |
| **Frontend State Store** | [`public/state.js`](public/state.js) | Central reactive store for repository, branch, commit plan, and debug sessions. |
| **Unified Diff Viewer** | [`public/components/diff-viewer.js`](public/components/diff-viewer.js) | Syntax-highlighted continuous and modal unified diff renderer. |
| **Commit Plan Organizer** | [`public/components/commit-plan.js`](public/components/commit-plan.js) | Interactive cards for review, risk tags, and one-click commit execution. |
| **Dashboard View** | [`public/views/dashboard.js`](public/views/dashboard.js) | System health, active repo metrics, and recent commit activity. |
| **Repositories View** | [`public/views/repositories.js`](public/views/repositories.js) | Workspace mounting, Windows Native Dialog, in-app file browser, GitHub auth. |
| **AI Debugging Console** | [`public/views/debugging.js`](public/views/debugging.js) | Autonomous 28-state debugging console, SSE stream, rollback triggers. |
| **Git Desktop Controller** | [`public/views/git-desktop.js`](public/views/git-desktop.js) | Working tree table, branch modal, continuous diff, push preview, post-push report. |
| **Pull Requests Hub** | [`public/views/pull-requests.js`](public/views/pull-requests.js) | PR list, Create PR modal, diff viewer, merge strategy selector. |
| **Issue Triage View** | [`public/views/issues.js`](public/views/issues.js) | Issue listing, triage filters, one-click debug session launcher. |
| **4-Way Conflict Center** | [`public/views/conflicts.js`](public/views/conflicts.js) | Side-by-side 4-way editor, AI semantic merge, automated test validator. |
| **Commit History Timeline** | [`public/views/history.js`](public/views/history.js) | Interactive commit log, short SHAs, author cards, commit diff viewer. |
| **Settings & Configuration** | [`public/views/settings.js`](public/views/settings.js) | Groq LLaMA models, API key configuration, theme toggle, cache flush. |
| **Master Navigation & Router** | [`public/app.js`](public/app.js) | Keyboard shortcuts, tab switcher, global notification toasts. |
| **CSS Styles & Design System** | [`public/styles.css`](public/styles.css) | Glassmorphic design tokens, dark theme colors, animations. |
| **Backend REST & SSE API** | [`src/app.ts`](src/app.ts) | Express server routing, middleware, probe endpoints. |
| **Native OS Dialogs & FS** | [`src/api/fs.ts`](src/api/fs.ts) | PowerShell `FolderBrowserDialog`, OS file explorer reveal, path normalization. |
| **Git Engine Process Exec** | [`src/git/engine.ts`](src/git/engine.ts) | Safe direct `execFile("git")` execution, operations catalog, risk tiers. |
| **Git Push Safeguards** | [`src/git/push.ts`](src/git/push.ts) | Protected branch lists, force-push blocking, divergence checks. |
| **AI Commit Planner** | [`src/git/change-analyzer.ts`](src/git/change-analyzer.ts) | Groq LLM Conventional Commit grouping, atomic sequential commit execution. |
| **Agent State Machine** | [`src/agent/state-machine.ts`](src/agent/state-machine.ts) | 28 execution states, transition event dispatchers. |
| **Critic Safety Gate** | [`src/agent/critic.ts`](src/agent/critic.ts) | Review criteria, risk scoring, dangerous patch rejection. |
| **Merge Conflict Analyzer** | [`src/git/conflicts.ts`](src/git/conflicts.ts) | 3-way conflict parser and semantic resolution strategies. |
| **Code Graph & AST Indexer** | [`src/ingestion/parser.ts`](src/ingestion/parser.ts) | TypeScript Compiler symbol and entity extraction. |

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
