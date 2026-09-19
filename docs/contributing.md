# 🤝 Contributing to Autonomous AI Git Debugging Agent

Thank you for contributing to the Autonomous AI Git Debugging Agent project. This guide outlines our engineering standards, pull request processes, and testing workflows.

---

## 1. Development Environment Setup

### Prerequisites
- **Node.js**: v22.x LTS (recommended) or v20.x+
- **Git**: 2.38+
- **MongoDB Atlas** account (or local MongoDB 7+ instance for development)

### Quick Start
```bash
# 1. Clone the repository
git clone https://github.com/HarshPariya/git-agent.git
cd git-agent

# 2. Install dependencies
npm ci

# 3. Setup environment variables
cp .env.example .env

# 4. Start local development server
npm run dev
```

---

## 2. Coding Standards & Conventions

1. **TypeScript Strict Mode**:
   - Do not use `any` unless strictly interfacing with dynamic external payloads.
   - All async functions must specify return types (e.g. `Promise<void>`, `Promise<GitStatusOutput>`).
   - Strict null checks must be respected. Use optional chaining (`?.`) and nullish coalescing (`??`).

2. **Code Formatting & Linting**:
   - Format all files with Prettier: `npm run format`
   - Verify formatting compliance: `npm run format:check`
   - Lint with ESLint: `npm run lint`

3. **Git & Commit Conventions**:
   - Commits must follow [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` for new capabilities.
     - `fix:` for bug fixes.
     - `test:` for test suites and assertions.
     - `docs:` for documentation.
     - `refactor:` for architectural improvements.
     - `ci:` for GitHub Actions workflow changes.

4. **Security Standards**:
   - Never log secrets, passwords, or raw tokens.
   - Enforce path boundary validation with `isPathWithinRoot()` on any filesystem logic.
   - Preserve protected branch guardrails in `src/git/push.ts`.
   - Scrub sensitive patterns using `SecretScanner` and `InputGuard`.

---

## 3. Testing & CI/CD Pipeline

All contributions must pass the complete automated test suite and formatting checks before opening a Pull Request.

### Running Quality Checks & Tests Locally
```bash
# Verify code formatting
npm run format:check

# Run ESLint
npm run lint

# Type check the entire codebase
npm run typecheck

# Compile production bundle to dist/
npm run build

# Run the master automated test runner (all 10 test suites)
npm test

# Run modular test suites individually
npm run test:git             # Git Engine, Security Controls & Push Safeguards
npm run test:agent           # Multi-Agent Orchestrator, State Machine & Planner
npm run test:api             # Express Endpoints, Repositories & CI API
npm run test:guardrails      # Input/Output Guards & Security Filters
npm run test:change-analyzer # Change Analyzer & Conventional Commit Planner
npm run test:e2e-workflow    # End-to-end Bare Origin Push & Branch Operations
npm run test:repo-isolation  # Multi-Repository Workspace Isolation & Scoping

# Run GraphRAG & Ingestion Tests
npm run rag:security-test    # File sanitization & secret filtering
npm run rag:limits-test      # Resource boundaries & query length limits
npm run rag:graph            # Code graph extraction & traversal
npm run rag:retrieve         # Hybrid search & reranking
```

### GitHub Actions CI
The CI pipeline ([`.github/workflows/ci.yml`](file:///c:/Users/harsh/Desktop/Codage-tasks/Git-Agent/.github/workflows/ci.yml)) automatically runs on pushes and pull requests across `main`, `development`, and `feature/**` branches. It validates 8 distinct jobs:
1. **Lint & Format**: Runs `npm run lint` (ESLint) and `npm run format:check` (Prettier).
2. **Type Check**: Runs `npm run typecheck` (`tsc --noEmit`).
3. **Build**: Compiles production bundle with `npm run build` and uploads artifact.
4. **Test Suite**: Runs the core test suite (`npm test`) against an isolated MongoDB 7 service container.
5. **Security**: Verifies file sanitization (`npm run rag:security-test`) and boundary guardrails (`npm run rag:limits-test`).
6. **RAG Integration**: Tests database connectivity, vector search, code graphs, hybrid retrieval, and ingestion pipelines.
7. **RAG Benchmarks**: Evaluates retrieval accuracy and regression benchmarks.
8. **Docker Build**: Validates multi-stage Docker image packaging via Buildx.

---

## 4. Branching Strategy

- `main`: Production-ready release branch. Pushes directly to `main` are restricted.
- `development`: Primary integration branch.
- `feature/<feature-name>`: Topic branches for new capabilities.
- `fix/<issue-name>`: Bug fix branches.
