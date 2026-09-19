# 🐙 Autonomous AI Git Debugging Agent

[![Production CI Pipeline](https://github.com/HarshPariya/git-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/HarshPariya/git-agent/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/badge/Node.js-22.x%20LTS-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas%20Vector%20Search-47A248.svg)](https://www.mongodb.com/atlas)
[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://opensource.org/licenses/ISC)

> **Enterprise-grade Autonomous Git Debugging & Code Intelligence Platform.**  
> Automatically diagnoses bugs, isolates defect root causes using GraphRAG and AST intelligence, performs 3-way merge conflict resolution, validates patches with senior code review guardrails, runs dynamic CI pipeline triage, and safely coordinates Git operations with protected branch push safeguards.

---

## 📖 Quick Documentation Links (1-Click Access)

Click any link below to directly open the complete documentation guide:

| Document | 1-Click Link | Description |
| :--- | :--- | :--- |
| 🏛️ **System Architecture** | [**`docs/architecture.md`**](docs/architecture.md) | Technical architecture, 9 modular views, Git engine, GraphRAG, repository scoping, and test pyramid |
| 🔄 **Workflows & Customization** | [**`docs/workflow.md`**](docs/workflow.md) | End-to-end debugging loop, CI triage, PR lifecycle, 3-way merge conflict resolution, and code directory |
| 📡 **API Specification** | [**`docs/api.md`**](docs/api.md) | Complete REST endpoints, CI pipeline API, request/response schemas, SSE stream events, and error codes |
| 🤝 **Contributing Guide** | [**`docs/contributing.md`**](docs/contributing.md) | Code standards, branching model, Prettier formatting, CI/CD pipeline, and 10-suite test runner commands |
| ⚡ **n8n Automation** | [**`docs/n8n-setup.md`**](docs/n8n-setup.md) | Webhook triggers for issue triage, CI diagnosis, PR code reviews, and post-commit audit automation |

---

## 📑 Table of Contents

- [📖 Quick Documentation Links](#-quick-documentation-links-1-click-access)
- [Key Capabilities](#-key-capabilities)
- [System Architecture](#-system-architecture)
- [End-to-End Workflows](#-end-to-end-workflows)
  - [1. Connecting Workspaces & Repositories](#1-connecting-workspaces--repositories)
  - [2. Autonomous Issue & Bug Debugging](#2-autonomous-issue--bug-debugging)
  - [3. Continuous Integration & Pipeline Diagnostics](#3-continuous-integration--pipeline-diagnostics)
  - [4. 3-Way Merge Conflict Resolution](#4-3-way-merge-conflict-resolution)
  - [5. Protected Git Operations & Push Safeguards](#5-protected-git-operations--push-safeguards)
  - [6. Automated Git Bisect & Regression Isolation](#6-automated-git-bisect--regression-isolation)
- [Quick Start](#-quick-start)
- [Configuration & Environment](#-configuration--environment)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Documentation Index](#-documentation-index)
- [Where to Modify Code](#-where-to-modify-code)

---

## 🚀 Key Capabilities

- **Strict Repository Scoping & Zero Bleeding**:
  - Every debug session, AST traversal, and Git operation strictly binds to the active repository via `RepositoryContext`.
  - Zero cross-repository context leakage; host paths are dynamically resolved with explicit validation.
- **9 Distinct Modular Frontend Views**:
  - `Dashboard`: System health, active repo metrics, quick action triggers, and recent debug sessions.
  - `Repositories`: Workspace manager with host OS folder dialog, local filesystem browser, and GitHub token connector.
  - `AI Debugging`: Autonomous 28-state reasoning console with real-time SSE stream, root-cause analyzer, and patch preview.
  - `Issues`: Repository bug tracker with 1-click autonomous AI triage.
  - `Pull Requests`: PR review and merge hub with verified branch targets (`head → base`) and GitHub sync.
  - `CI Runs`: Continuous Integration pipeline runner with real-time step log inspection, failure diagnostics, and 1-click AI triage.
  - `History`: High-density session cards with client-side instant search, execution durations, and 1-click session reopening.
  - `Settings`: Personal Access Tokens, LLM configuration (Groq LLaMA 3.3 70B), and account session controls.
  - `Admin Center`: Obsidian glassmorphic telemetry dashboard, user management, and system activity streams.
- **Multi-Device Responsive Architecture**:
  - Fluid, medium-proportioned layout across **Desktop (1440px+)**, **Laptops (1024px-1200px)**, **Tablets (768px-1024px)**, and **Mobile (iPhone / Android 390px-640px)**.
  - Slide-over mobile drawer (`#mobile-nav-drawer`) with backdrop blur, active workspace pill, and touch-friendly controls.
  - Compact 2x2 stat grids on mobile screens preventing vertical bloat.
- **Windows Native OS Integration**: Built-in PowerShell .NET `[System.Windows.Forms.FolderBrowserDialog]` integration via `POST /api/fs/pick-native-dialog` and host OS File Explorer reveal via `POST /api/fs/open-in-os`.
- **4-Way Conflict Center**: Real-time side-by-side inspection (`BASE | OURS | THEIRS | AI RESOLUTION`) with syntax-safe semantic merge and automated test execution.
- **GraphRAG Code Intelligence**: Combines TypeScript Compiler AST extraction with 384-dimensional semantic feature hashing, dependency graph traversal, and Reciprocal Rank Fusion (RRF) reranking.
- **Strict Git Safety Rails & Push Safeguards**: Classifies 19 Git operations into `safe`, `controlled`, and `dangerous`. Direct `execFile("git")` execution prevents Windows shell `%h` formatting corruption. Blocks raw `--force` pushes and direct pushes to protected branches (`main`, `master`, `production`, `release`, `develop`, `staging`).
- **Deterministic 1-Click Rollback**: Automatically creates in-memory and disk snapshot backups before modifying any file, enabling instant reversion if tests fail.

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
│ • Patch Engine          │ │ • Auto Bisect       │ │ • MongoDB Atlas    │
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
- *(Optional)* MongoDB Atlas account (or local MongoDB instance)

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
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net
MONGODB_DB_NAME=ai_chatbot
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

The project includes an enterprise-grade automated test suite with **10 test suites and 100% pass rate**:

```bash
# Run complete test suite (all 10 suites: Git Engine, Agent, API, Guardrails, Change Analyzer, E2E Workflow, Recovery, n8n, Scoping, Smoke)
npm test

# Run modular test suites individually
npm run test:git           # Git operations, branch protection, conflicts
npm run test:agent         # Multi-agent state machine, Critic, Patch Engine
npm run test:api           # Express routes, auth, filesystem browser
npm run test:guardrails    # InputGuard, OutputGuard, resource limits
npm run test:change-analyzer # Change detection, semantic clustering, atomic commits
npm run test:e2e-workflow  # End-to-end bare origin push, commit plan, branch switching

# Run Ingestion & GraphRAG verification
npm run rag:security-test  # Path traversal and secret filtering
npm run rag:limits-test    # Resource limits and boundary enforcement
npm run rag:graph          # Code graph building and traversal
npm run rag:hybrid         # Hybrid retrieval engine
npm run rag:retrieve       # Multi-query code retriever
npm run rag:integration-test # Full retrieval integration verification

# Code formatting & type check
npm run format:check       # Validate Prettier formatting
npm run format             # Auto-format codebase
npm run lint               # Run ESLint across src/
npm run typecheck          # TypeScript type check (tsc --noEmit)
npm run build              # Compile production bundle
```

---

## 📚 Documentation Index

The complete documentation suite consists of 5 focused guides:

| Document | Direct 1-Click Link | Key Topics Covered |
| :--- | :--- | :--- |
| 🏛️ **System Architecture** | [**`docs/architecture.md`**](docs/architecture.md) | High-level system overview, 9 modular views, agentic framework, cross-platform Git engine, GraphRAG retrieval, security guardrails, and 10-suite test pyramid. |
| 🔄 **Workflow & Customization** | [**`docs/workflow.md`**](docs/workflow.md) | End-to-end debugging loop, CI triage, 3-way conflict resolution, PR lifecycle, and complete code directory. |
| 📡 **API Specification** | [**`docs/api.md`**](docs/api.md) | REST endpoints reference: System probes, Authentication, Filesystem (`/api/fs/*`), Git operations (`/api/git/*`), CI runs (`/api/ci/*`), and Autonomous Debugging (`/api/debug/*`). |
| 🤝 **Contributing Guide** | [**`docs/contributing.md`**](docs/contributing.md) | Development environment setup, TypeScript guidelines, Conventional Commits, formatting, and CI/CD matrix. |
| ⚡ **n8n Automation** | [**`docs/n8n-setup.md`**](docs/n8n-setup.md) | Self-hosted n8n webhooks for automated issue triage, CI diagnosis, and PR reviews. |

---

## 🛠️ Where to Modify Code

| Feature Area | Source File | Description |
| :--- | :--- | :--- |
| **Frontend State Store** | [`public/state.js`](public/state.js) | Central reactive store for repository, branch, commit plan, and debug sessions. |
| **Dashboard View** | [`public/views/dashboard.js`](public/views/dashboard.js) | System health, active repo metrics, quick action cards, and recent activity. |
| **Repositories View** | [`public/views/repositories.js`](public/views/repositories.js) | Workspace mounting, Windows Native Dialog, in-app file browser, GitHub auth. |
| **AI Debugging Console** | [`public/views/debugging.js`](public/views/debugging.js) | Autonomous 28-state debugging console, SSE stream, rollback triggers. |
| **Pull Requests Hub** | [`public/views/pull-requests.js`](public/views/pull-requests.js) | PR list, Create PR modal, diff viewer, merge strategy selector. |
| **Issue Triage View** | [`public/views/issues.js`](public/views/issues.js) | Issue listing, triage filters, one-click debug session launcher. |
| **CI Runs & Pipelines** | [`public/views/ci.js`](public/views/ci.js) | CI pipeline runs, real-time step log inspection, autonomous failure triage. |
| **4-Way Conflict Center** | [`public/views/conflicts.js`](public/views/conflicts.js) | Side-by-side 4-way editor, AI semantic merge, automated test validator. |
| **Debug History Timeline** | [`public/views/history.js`](public/views/history.js) | Rich session cards, instant client-side search, execution durations. |
| **Admin Control Center** | [`public/views/admin.js`](public/views/admin.js) | Obsidian telemetry, user management, structured activity stream. |
| **Settings & Configuration** | [`public/views/settings.js`](public/views/settings.js) | Groq LLaMA models, API key configuration, theme toggle, cache flush. |
| **Master Navigation & Router** | [`public/app.js`](public/app.js) | Keyboard shortcuts, tab switcher, mobile drawer toggles, toast notifications. |
| **CSS Styles & Design System** | [`public/styles.css`](public/styles.css) | Glassmorphic design tokens, responsive breakpoints, mobile drawer styles. |
| **Backend REST & SSE API** | [`src/app.ts`](src/app.ts) | Express server routing, middleware, probe endpoints. |
| **CI/CD API Controller** | [`src/api/ci.ts`](src/api/ci.ts) | Pipeline run endpoints, live status tracking, failure diagnosis triggers. |
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
