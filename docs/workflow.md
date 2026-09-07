# 🔄 Autonomous AI Git Debugging Agent — Workflow Guide

This guide details the complete, end-to-end workflows of the Autonomous AI Git Debugging Agent platform. It explains exactly how the frontend and backend interact to resolve issues, pull requests, merge conflicts, and execute safe Git operations, along with instructions on where to modify code to customize system behavior.

---

## 1. Complete Workflow Directory

```mermaid
flowchart TD
    START([User Initiates Action]) --> ACTION{Select Action}
    
    ACTION -->|1. Connect Workspace| WF1[Mount Folder or GitHub Repo]
    ACTION -->|2. Debug Bug / Issue| WF2[Autonomous Multi-Step Debug Loop]
    ACTION -->|3. Merge Conflicts| WF3[3-Way Conflict Analyzer & Resolver]
    ACTION -->|4. GitHub Issue / PR| WF4[Automated PR Generation & Review]
    ACTION -->|5. Git Operations| WF5[Controlled Terminal & Push Safeguards]
    ACTION -->|6. Regressions| WF6[Automated Git Bisect Runner]

    WF1 --> READY([Repository Indexed & Active])
    WF2 --> VERIFIED([Patch Tested & Approved])
    WF3 --> MERGED([Conflict Resolved & Staged])
    WF4 --> PR_CREATED([PR Submitted with Evidence])
    WF5 --> EXECUTED([Safe Command Complete])
    WF6 --> CULPRIT([Regression Commit Isolated])
```

---

## 2. Workflow 1: Connecting Workspaces & Repositories

### Step-by-Step Flow:
1. **Frontend Interaction**:
   - The user opens the **Repositories** tab in the SPA.
   - The user can connect in three ways:
     - **Native OS Folder Picker**: Clicking "Browse Folder" opens the folder browser modal. The modal requests `/api/fs/browse` to inspect drives and directories (Windows drives `C:\`, `D:\`, or Unix root `/`), highlighting Git repositories with badges.
     - **Direct Path Entry**: Typing an absolute folder path (e.g. `C:\Users\username\Projects\my-app`) and clicking "Connect Local Repository".
     - **GitHub Connect**: Entering a GitHub Personal Access Token (`ghp_...`) to browse and clone remote repositories.
2. **Backend Processing (`src/api/repositories/connect.ts`)**:
   - Validates that the target path exists on the local filesystem.
   - Executes `git rev-parse --is-inside-work-tree` via `src/git/engine.ts` to confirm Git initialized status.
   - Extracts branch names, remote URLs, and current commit hash.
   - Registers repository in `repositoryStore` and returns repository metadata.
3. **Background GraphRAG Indexing (`src/graph/repository-indexer.ts`)**:
   - The repository is automatically scheduled for AST parsing and dependency graph extraction.

---

## 3. Workflow 2: Autonomous Bug & Issue Debugging

This is the flagship autonomous reasoning loop. It resolves software defects from natural language queries or error stack traces.

```mermaid
sequenceDiagram
    autonumber
    actor User as Developer (Frontend)
    participant API as Express API Router
    participant Orch as Debug Orchestrator
    participant SM as State Machine
    participant Planner as Task Planner
    participant Ctx as Context Builder
    participant Graph as GraphRAG Retriever
    participant Hypo as Hypothesis Engine
    participant Fix as Fix Planner
    participant Critic as Critic Agent
    participant Patch as Patch Engine
    participant Git as Git Engine

    User->>API: POST /api/debug/run { query, repositoryId }
    API->>Orch: Start Debug Session
    Orch->>SM: transition(INITIALIZING)
    Orch-->>User: Open SSE Stream (/api/debug/:id/stream)

    Orch->>Planner: classify(query)
    Planner-->>Orch: InvestigationPlan (5 phases)
    Orch->>SM: transition(SCANNING_REPOSITORY)

    Orch->>Ctx: buildContext(repoId, query)
    Ctx->>Git: executeGitStatus + executeGitDiff + executeGitLog
    Ctx->>Graph: retrieve relevant symbols & call graph
    Ctx-->>Orch: DebugContext (diffs, symbols, blame)

    Orch->>SM: transition(GENERATING_HYPOTHESES)
    Orch->>Hypo: generateHypotheses(context)
    Hypo-->>Orch: Ranked hypotheses with evidence scores

    Orch->>SM: transition(DIAGNOSING_ROOT_CAUSE)
    Orch->>Fix: createFixPlan(selectedHypothesis, context)
    Fix-->>Orch: FixPlan (patches, tests, risk: LOW/CRITICAL)

    Orch->>SM: transition(VALIDATING_PATCH_SAFETY)
    Orch->>Critic: review(plan, context, testsPassed)
    
    alt Critic Rejects Plan
        Critic-->>Orch: REJECTED (Unsafe command or poor fix)
        Orch->>SM: transition(FAILED)
        Orch-->>User: SSE Event "session_failed" with reason
    else Critic Approves Plan
        Critic-->>Orch: APPROVED (Safe patch)
        Orch->>SM: transition(SYNTHESIZING_PATCH)
        Orch->>Patch: applyPatch(repoPath, changes)
        Patch->>Patch: Create snapshot backup in backupStore
        Patch-->>Orch: PatchResult (diff, backupId)
        
        Orch->>SM: transition(EXECUTING_TARGETED_TESTS)
        Orch->>Git: Run automated test suite
        
        Orch->>SM: transition(COMPLETED)
        Orch-->>User: SSE Event "session_completed" (diff, findings, backupId)
    end
```

### Human-in-the-Loop Approval & Revert Protocol:
- If a patch has a `HIGH` or `CRITICAL` risk rating, the orchestrator pauses in state `REVIEWING_DIFF`.
- The frontend displays the unified diff viewer with highlighted additions and deletions.
- **Approve**: Clicking "Approve Fix" calls `POST /api/debug/:id/approve`, prompting the agent to commit the fix with a conventional commit message.
- **Revert**: Clicking "Revert Fix" calls `POST /api/debug/:id/revert`, invoking `revertPatch(backupId)` in `src/agent/patch-engine.ts`, restoring all modified files to their exact pre-patch byte state.

---

## 4. Workflow 3: 3-Way Merge Conflict Resolution

When merging branches or pulling from remotes results in merge conflicts, the agent resolves them automatically or semi-automatically.

```mermaid
flowchart TD
    C_START[Merge Conflict Triggered] --> C_SCAN[ConflictAnalyzer.analyzeRepository]
    C_SCAN --> C_DETECT{Conflict Files Found?}
    C_DETECT -- No --> C_CLEAN[Report: Clean Working Tree]
    C_DETECT -- Yes --> C_PARSE[Parse <<<<<<<, =======, >>>>>>> Markers]
    
    C_PARSE --> C_EXTRACT[Extract ourLines, theirLines, baseLines]
    C_EXTRACT --> C_EVAL[Semantic & AST Impact Evaluation]
    
    C_EVAL --> C_STRAT{Resolution Strategy}
    C_STRAT -->|Option A: Keep Ours| C_OURS[Select Local Lines]
    C_STRAT -->|Option B: Keep Theirs| C_THEIRS[Select Incoming Lines]
    C_STRAT -->|Option C: AI Semantic Merge| C_AI[Groq LLM / AST Synthesized Code]
    
    C_OURS --> C_APPLY[Write Resolved File]
    C_THEIRS --> C_APPLY
    C_AI --> C_APPLY
    
    C_APPLY --> C_STAGE[git add resolved_file]
    C_STAGE --> C_DONE([Conflict Resolved])
```

### Steps:
1. User navigates to the **Conflicts** tab in the UI or triggers conflict resolution on a branch.
2. `src/git/conflicts.ts` runs `git status --porcelain`, identifying files marked with status codes `UU`, `AA`, `DD`, etc.
3. For each conflicted file, `ConflictAnalyzer.analyzeFile()` decomposes the conflict blocks into `ConflictMarker` objects.
4. The system renders the **4-Way Conflict Center (`BASE | OURS | THEIRS | AI RESOLUTION`)**:
   - `BASE`: Common ancestor version of the conflicting lines.
   - `OURS`: Current HEAD changes on the local branch.
   - `THEIRS`: Incoming changes from the target branch or remote.
   - `AI RESOLUTION`: Groq LLM + GraphRAG semantic merge that reconciles logic, resolves conflicting imports, and eliminates syntax breakage.
5. Developer can review side-by-side, click "Accept AI Resolution" or manually select "Accept Ours" / "Accept Theirs".
6. The engine writes the resolved file, runs `git add <file>`, and executes verification tests to ensure the working tree builds cleanly before concluding the merge.

---

## 5. Workflow 4: Git Desktop (Workspace B) & AI Commit Planner

Git Desktop provides a first-class visual repository controller powered by AI semantic code intelligence:

```mermaid
flowchart TD
    GD_START[Open Git Desktop] --> GD_DETECT[Scan Working Tree Changes]
    GD_DETECT --> GD_TABLE[Render Changed Files Table + Risk Badges]
    
    GD_TABLE --> GD_ACT{Developer Action}
    GD_ACT -->|AI Analyze Changes| GD_PLAN[Groq LLM + GraphRAG Clustering]
    GD_ACT -->|Fetch / Pull / Sync| GD_REMOTE[Execute Remote Operations with Dirty Tree Check]
    GD_ACT -->|Push| GD_PREVIEW[Open Push Preview Modal & Check Safeguards]
    GD_ACT -->|AI Ship| GD_SHIP[Analyze -> Plan -> Commit -> Push -> PR]
    
    GD_PLAN --> GD_CARDS[Display Logical Commit Plan Cards]
    GD_CARDS --> GD_COMMIT_ALL[One-Click AI Commit All]
    GD_COMMIT_ALL --> GD_SEQ[Sequential Atomic Staging: Reset Index -> Stage Group 1 -> Commit & Verify SHA -> Stage Group 2...]
    GD_SEQ --> GD_CLEAN[Working Tree Cleaned & Log Updated]
    
    GD_PREVIEW --> GD_SAFE{Passes Safeguards?}
    GD_SAFE -- No --> GD_BLOCK[Blocked: Force Push / Protected Branch Violation]
    GD_SAFE -- Yes --> GD_PUSH_EXEC[Safe Push Executed]
```

### Key Technical Guarantees:
1. **Never Blind `git add .`**:
   - `src/git/change-analyzer.ts` groups files into cohesive functional units (e.g. Auth, API, Docs, Tests).
   - In `executeCommitPlan`, the staging index is cleared (`git reset HEAD`), then each group's files are explicitly staged and committed with verified commit SHAs (`git rev-parse --short HEAD`).
2. **Push Preview Modal**:
   - Displays target remote/branch, commits to be pushed, files touched, protected branch check, and secret scanning status before any push packet is sent to GitHub.
3. **Automated AI Ship**:
   - Orchestrates the full development pipeline in one click: analyze -> generate commit plan -> atomic commit all -> pre-push safeguard check -> safe push -> open automated Pull Request.

---

## 6. Workflow 5: GitHub Issues & Pull Requests

1. **Issue Triage**:
   - The user connects GitHub on the **Issues** tab.
   - The agent fetches issues via `src/github/issues.ts`.
   - Clicking "Debug Issue" imports the issue title, body, and labels directly into the Autonomous Debugging Agent loop.
2. **Automated Fix & PR Creation**:
   - Once the fix is generated and verified, the user clicks "Create Pull Request".
   - `src/github/pull-requests.ts` creates a new branch (e.g., `fix/issue-104-null-pointer`).
   - Pushes the verified commit using `executeSafePush`.
   - Calls the GitHub API to open a Pull Request with an automated description detailing:
     - Root cause analysis summary.
     - Files modified with diff stats.
     - Test verification output.
     - Closes `#<issue_number>` keyword for auto-closing on merge.

---

## 7. Workflow 6: Controlled Git Operations & Push Safeguards

The platform acts as a secure Git controller preventing accidental repo corruption.

### Pre-Push Verification Flow (`src/git/push.ts`):
```mermaid
flowchart TD
    P_CMD[User / Agent calls git push] --> P_STATUS[executeGitStatus]
    P_STATUS --> P_DIRTY{Working Tree Clean?}
    P_DIRTY -- No --> P_WARN[Add warning: Uncommitted changes]
    P_DIRTY -- Yes --> P_BEHIND{Behind Remote?}
    P_WARN --> P_BEHIND
    
    P_BEHIND -- Yes --> P_BLOCK_BEHIND[BLOCK: Behind remote. Pull/rebase required.]
    P_BEHIND -- No --> P_FORCE{Force flag present?}
    
    P_FORCE -- Yes --> P_NAKED{Naked --force?}
    P_NAKED -- Yes --> P_BLOCK_NAKED[BLOCK: Raw force push strictly forbidden]
    P_NAKED -- No --> P_PROT{Target Protected Branch?}
    
    P_FORCE -- No --> P_PROT
    P_PROT -- Yes --> P_BLOCK_PROT[BLOCK: Cannot force-push to main/master/production]
    P_PROT -- No --> P_EXEC[Execute git push with lease]
```

### Commit Formatting Flow (`src/git/commit.ts`):
- When committing changes, `formatCommitMessage` generates Conventional Commits:
  `fix(agent): resolve null pointer in token validation`
- Automatically extracts author attribution (`Harsh Pariya <hpariya195@gmail.com>`).
- Uses `git rev-parse --short HEAD` for deterministic commit hash tracking.

---

## 8. Workflow 7: Automated Git Bisect & Regression Pinpointing

When code breaks between two known revisions:
1. User provides a **Good Commit** (where behavior worked) and a **Bad Commit** (current regression).
2. `src/git/bisect.ts` starts an automated binary search session:
   - Executes `git bisect start <bad> <good>`.
   - At each midpoint commit, executes the user's automated test command (e.g. `npm test` or a custom test script).
   - Marks commit as `git bisect good` or `git bisect bad` based on the test exit code.
3. Automatically isolates the exact commit that introduced the failure, returning:
   - Culprit commit hash and author.
   - Commit message and date.
   - File diff associated with the regression.

---

## 8. Where to Modify Code (Customization Guide)

If you want to modify or extend the system, use this reference:

| To Change... | Edit This File | What to Do |
| :--- | :--- | :--- |
| **Frontend UI Styles & Theme** | [`public/styles.css`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/public/styles.css) | Modify CSS custom properties (`:root` colors, glassmorphism blur, fonts, responsive breakpoints). |
| **Frontend Layout & Tabs** | [`public/index.html`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/public/index.html) | Add new navigation buttons, tab panels, modals, or visualizer elements. |
| **Frontend Event Handling** | [`public/app.js`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/public/app.js) | Change how tabs switch, how SSE events render, or folder picker dialogs interact. |
| **API Endpoints & Routing** | [`src/app.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/app.ts) | Add or modify Express routes, middleware, or system health handlers. |
| **Agent Investigation Plan** | [`src/agent/planner.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/agent/planner.ts) | Customize the 5 investigation phases (`isolate`, `reproduce`, `diagnose`, `fix`, `verify`). |
| **Hypothesis Generation & LLM** | [`src/agent/hypothesis-engine.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/agent/hypothesis-engine.ts) | Adjust prompts, temperature, ranking algorithms, or candidate count. |
| **Critic Agent Review Rules** | [`src/agent/critic.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/agent/critic.ts) | Customize scoring thresholds (e.g., score >= 80 to approve), add security criteria, or forbid additional commands. |
| **Patch Application & Rollback** | [`src/agent/patch-engine.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/agent/patch-engine.ts) | Change how file snapshots are stored, unified diff formatting, or rollback behavior. |
| **Protected Branches & Git Limits** | [`src/git/engine.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/git/engine.ts) | Edit `PROTECTED_BRANCH_PATTERNS` to add/remove protected branch names or reclassify operation risks. |
| **Merge Conflict Logic** | [`src/git/conflicts.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/git/conflicts.ts) | Tweak conflict marker parsing or the AI semantic resolution strategy. |
| **GraphRAG Code Retrieval** | [`src/retrieval/retriever.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/retrieval/retriever.ts) | Tune hybrid search weighting between graph edges and vector similarity. |
| **Prompt Injection & Guardrails** | [`src/guardrails/input-guard.ts`](file:///c:/Users/harsh/Desktop/Codage-tasks/ai-chatbot/src/guardrails/input-guard.ts) | Add injection regex patterns or adjust input length limits. |
