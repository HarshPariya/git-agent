# 🤝 Contributing to Autonomous AI Git Debugging Agent

Thank you for contributing to the Autonomous AI Git Debugging Agent project. This guide outlines our engineering standards, pull request processes, and testing workflows.

---

## 1. Development Environment Setup

### Prerequisites
- **Node.js**: v22.x LTS (recommended) or v20.x+
- **Git**: 2.38+
- **MongoDB Atlas** account (or local MongoDB instance for development)

### Quick Start
```bash
# 1. Clone the repository
git clone https://github.com/HarshPariya/ai-chatbot.git
cd ai-chatbot

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

2. **Git & Commit Conventions**:
   - Commits must follow [Conventional Commits](https://www.conventionalcommits.org/):
     - `feat:` for new capabilities.
     - `fix:` for bug fixes.
     - `test:` for test suites and assertions.
     - `docs:` for documentation.
     - `refactor:` for architectural improvements.
     - `ci:` for GitHub Actions workflow changes.

3. **Security Standards**:
   - Never log secrets, passwords, or raw tokens.
   - Enforce path boundary validation with `isPathWithinRoot()` on any filesystem logic.
   - Preserve protected branch guardrails in `src/git/push.ts`.

---

## 3. Testing & CI/CD Pipeline

All contributions must pass the complete automated test suite before opening a Pull Request.

### Running Tests Locally
```bash
# Type check the entire codebase
npx tsc --noEmit

# Compile production bundle
npm run build

# Run the master automated test suite
npm test

# Run modular test suites individually
npm run test:git           # Git Engine & Safety Controls (24 tests)
npm run test:agent         # Multi-Agent Orchestrator & State Machine (18 tests)
npm run test:api           # Express Endpoints & JWT Authentication (21 tests)
npm run test:guardrails    # Input/Output Guards & Security Filters (22 tests)
npm run test:desktop       # Git Desktop change analyzer & atomic commits (38 tests)
npm run test:e2e-desktop   # End-to-end bare origin push & branch switching (16 assertions)

# Run GraphRAG & Ingestion Tests
npm run rag:security-test  # File sanitization & secret filtering
npm run rag:limits-test    # Resource boundaries & query length limits
npm run rag:graph          # Code graph extraction & traversal
npm run rag:retrieve       # Hybrid search & reranking
```

### GitHub Actions CI
The CI pipeline ([`.github/workflows/ci.yml`](file:///c:/Users/harsh/Desktop/Codage-tasks/Git-Agent/.github/workflows/ci.yml)) automatically runs on pushes and pull requests across `main`, `development`, and `feature/**` branches. It validates:
1. Clean dependency installation (`npm ci`)
2. Full type checking (`npx tsc --noEmit`)
3. Compilation (`npm run build`)
4. MongoDB Atlas connection tests (`npm run db:test`)
5. Full test suite runner (`npm test`)
6. RAG security and boundary verification

---

## 4. Branching Strategy

- `main`: Production-ready release branch. Pushes directly to `main` are restricted.
- `development`: Primary integration branch.
- `feature/<feature-name>`: Topic branches for new capabilities.
- `fix/<issue-name>`: Bug fix branches.
