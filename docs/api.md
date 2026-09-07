# 📡 Autonomous AI Git Debugging Agent — API Specification

This document provides complete reference documentation for all REST API endpoints, Server-Sent Events (SSE) streaming formats, request payloads, and response structures.

---

## 1. Authentication & Common Headers

### Base URL
- Local: `http://localhost:3000`
- Production: Configured via `PORT` and reverse proxy (e.g., Nginx, Caddy).

### Authorization Header
All protected endpoints require a valid JWT token issued by the registration or login endpoints:
```http
Authorization: Bearer <jwt_token>
```

### Standard Response Formats
- **Success (200/201)**: Returns JSON object or array.
- **Error (4xx/5xx)**:
  ```json
  {
    "error": {
      "message": "Human-readable description",
      "code": "VALIDATION_ERROR | AUTHENTICATION_ERROR | NOT_FOUND | GIT_ERROR",
      "statusCode": 400
    }
  }
  ```

---

## 2. System & Health Endpoints

### `GET /health`
Liveness probe providing database health, active connection counts, and retrieval status.
- **Response `200 OK`**:
  ```json
  {
    "status": "ok",
    "environment": "development",
    "modules": {
      "retrieval": "ready",
      "agent": "ready"
    },
    "database": {
      "status": "healthy",
      "latencyMs": 2,
      "poolIdleConnections": 10,
      "poolTotalConnections": 10,
      "waitingCount": 0
    }
  }
  ```

### `GET /ready` or `GET /readiness`
Readiness probe for container orchestrators (e.g. Kubernetes). Returns `200` when graph retrieval is ready, `503` when initializing.

### `GET /api/info`
Service metadata, version information, and route directory.

---

## 3. Authentication Endpoints

### `POST /api/auth/register`
Register a new developer account.
- **Request Body**:
  ```json
  {
    "email": "developer@example.com",
    "password": "SecurePassword123!",
    "name": "Alex Developer"
  }
  ```
- **Response `201 Created`**:
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": {
      "id": "user-uuid",
      "email": "developer@example.com",
      "name": "Alex Developer",
      "tenantId": "tenant-uuid"
    }
  }
  ```

### `POST /api/auth/login`
Authenticate with email and password to receive a JWT session token.

### `GET /api/auth/me` *(Protected)*
Inspect the currently authenticated user session.

---

## 4. Repository & Workspace Management

### `GET /api/repositories` *(Protected)*
List all mounted repositories for the current tenant.

### `POST /api/repositories/connect` *(Protected)*
Mount a local directory or remote repository.
- **Request Body**:
  ```json
  {
    "path": "C:\\Users\\username\\Projects\\my-service",
    "name": "my-service"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "repository": {
      "id": "my-service",
      "name": "my-service",
      "localPath": "C:\\Users\\username\\Projects\\my-service",
      "currentBranch": "main",
      "isGitRepo": true,
      "status": "active"
    }
  }
  ```

### `POST /api/repositories/:id/disconnect` *(Protected)*
Unmounts a repository from the active workspace.

### `GET /api/repositories/:id/protected-branches` *(Protected)*
List protected branches configured for the repository.

### `POST /api/repositories/:id/protected-branches` *(Protected)*
Add a branch name to the protected list (e.g., `staging`, `production`).

---

## 5. Filesystem & OS Integration Endpoints

### `GET /api/fs/browse?path=<url_encoded_path>` *(Protected)*
Browse local OS drives and directories with directory shortcuts (drives, workspaces) and git repository indicators.
- **Response `200 OK`**:
  ```json
  {
    "currentPath": "C:\\Users\\username\\Projects",
    "parentPath": "C:\\Users\\username",
    "isGitRepo": false,
    "shortcuts": [
      { "name": "C: Drive", "path": "C:\\" },
      { "name": "D: Drive", "path": "D:\\" }
    ],
    "directories": [
      {
        "name": "my-service",
        "path": "C:\\Users\\username\\Projects\\my-service",
        "isGitRepo": true
      }
    ],
    "files": [
      {
        "name": "notes.txt",
        "path": "C:\\Users\\username\\Projects\\notes.txt",
        "ext": ".txt",
        "sizeBytes": 1024
      }
    ]
  }
  ```

### `POST /api/fs/pick-native-dialog` *(Protected)*
Opens the native Windows OS directory dialog (`System.Windows.Forms.FolderBrowserDialog` via PowerShell with `$topForm.TopMost = $true`) in the foreground, allowing the user to select any folder on their computer.
- **Request Body**: `{}`
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "path": "C:\\Users\\username\\Desktop\\my-project",
    "folderName": "my-project",
    "cancelled": false
  }
  ```

### `POST /api/fs/open-in-os` *(Protected)*
Directly reveals a file/directory in the host operating system file manager (Windows File Explorer, macOS Finder, Linux xdg-open) or opens it in the default code editor (`code`).
- **Request Body**:
  ```json
  {
    "filePath": "src/api/git.ts",
    "repositoryId": "repo-ai-chatbot",
    "mode": "reveal | edit"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Revealed in File Explorer"
  }
  ```

### `POST /api/fs/resolve-folder` *(Protected)*
Resolves a folder name or dropped folder entry into an absolute disk path by searching the active workspace, home directory, and drive roots.
- **Request Body**:
  ```json
  {
    "folderName": "ai-chatbot",
    "sampleFiles": ["package.json", "src/app.ts"],
    "currentPath": "C:\\Users\\username\\Desktop"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "resolvedPath": "C:\\Users\\username\\Desktop\\ai-chatbot",
    "folderName": "ai-chatbot",
    "exists": true
  }
  ```

---

## 6. Autonomous Debugging Agent Endpoints

### `POST /api/debug/run` *(Protected)*
Launches a synchronous debug session and returns the complete result upon completion.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "query": "Fix TypeError: Cannot read properties of undefined in auth token validation"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "sessionId": "debug-session-123",
    "status": "COMPLETED",
    "rootCause": "Null check missing on decoded token payload",
    "patch": {
      "backupId": "patch-1725698000-xyz",
      "appliedFiles": ["src/security/auth.ts"],
      "diff": "--- a/src/security/auth.ts\n+++ b/src/security/auth.ts\n@@ -42,3 +42,5 @@\n+  if (!payload) return null;\n"
    },
    "criticReview": {
      "verdict": "APPROVED",
      "score": 85,
      "summary": "Fix correctly introduces null guard without regressions."
    },
    "testsPassed": true
  }
  ```

### `GET /api/debug/:sessionId/stream` *(SSE Stream)*
Real-time Server-Sent Events stream for live progress monitoring.
- **Stream Format (`text/event-stream`)**:
  ```text
  event: state_change
  data: {"from":"IDLE","to":"INITIALIZING","timestamp":"2026-09-07T08:00:00Z"}

  event: log
  data: {"level":"info","message":"Scanning repository files...","phase":"isolate"}

  event: hypothesis_generated
  data: {"id":"h-1","title":"Null reference on token.userId","confidence":0.88}

  event: patch_applied
  data: {"backupId":"patch-xyz","diff":"+ if (!payload) return null;","files":["src/security/auth.ts"]}

  event: session_completed
  data: {"sessionId":"debug-session-123","status":"COMPLETED"}
  ```

### `POST /api/debug/:sessionId/fix/approve` *(Protected)*
Approves an applied fix and commits changes to Git.

### `POST /api/debug/:sessionId/fix/revert` *(Protected)*
Instantly rolls back an applied patch using the snapshot backup.

---

## 7. Git Engine & Safeguard Endpoints

### `GET /api/git/catalog` *(Protected)*
Returns the 19 Git operations with their classified risk tiers (`safe`, `controlled`, `dangerous`).

### `GET /api/git/classify/:operation` *(Protected)*
Inspect the risk and approval requirements for an operation.

### `POST /api/git/status` *(Protected)*
Executes `git status --porcelain -b` for a repository.

### `POST /api/git/diff` *(Protected)*
Returns working tree diff or staged diff.

### `POST /api/git/commit` *(Protected)*
Safely commits changes with conventional commit message generation:
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "message": "fix(auth): add null guard to token parser",
    "stageAll": true
  }
  ```

### `POST /api/git/generate-commit-message` *(Protected)*
Uses the Groq LLM with strict Conventional Commit prompting and domain-aware fallbacks to synthesize a professional commit message with a concrete scope and 2-6 per-file bullet points.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "summary": "feat(git): add commit, branch switcher, and push preview modal",
    "description": "- src/api/git.ts: add commit message generator and checkout branch endpoints\n- public/views/git-desktop.js: integrate push preview modal and target branch selector\n- docs/api.md: document new REST endpoints and request schemas",
    "branch": "feature/git-agent"
  }
  ```

### `GET|POST /api/git/branches` *(Protected)*
Lists all local and remote branches in the repository, flagging the currently active branch.
- **Response `200 OK`**:
  ```json
  {
    "branches": [
      { "name": "main", "current": false },
      { "name": "feature/git-agent", "current": true },
      { "name": "remotes/origin/main", "current": false }
    ],
    "current": "feature/git-agent"
  }
  ```

### `POST /api/git/checkout` *(Protected)*
Checks out an existing branch or creates a new branch and checks it out.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "branch": "feature/new-task",
    "create": true
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "branch": "feature/new-task",
    "message": "Switched to a new branch 'feature/new-task'"
  }
  ```

### `POST /api/git/push` *(Protected)*
Executes `git push` with pre-push safety validations. Validates that the target branch is not protected without approval, verifies divergence, and supports upstream tracking and force-with-lease.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "remote": "origin",
    "targetBranch": "feature/git-agent",
    "setUpstream": true,
    "forceWithLease": false
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "branch": "feature/git-agent",
    "output": "To https://github.com/...\n   24dd56e..dd01f1e  feature/git-agent -> feature/git-agent"
  }
  ```

### `POST /api/git/pull` *(Protected)*
Executes `git pull` from remote tracking branch, checking for dirty working tree state and reporting merge conflicts.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service"
  }
  ```

### `POST /api/git/fetch` *(Protected)*
Fetches all remote references and branches from origin.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service"
  }
  ```

### `POST /api/git/commit` *(Protected)*
Safely commits changes with conventional commit message generation:
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "message": "fix(auth): add null guard to token parser",
    "stageAll": true
  }
  ```

### `POST /api/git/conflicts` *(Protected)*
Scans the repository for merge conflicts and returns 3-way conflict hunks.

### `POST /api/git/conflicts/resolve` *(Protected)*
Resolves a conflicted file using strategy `"ours"`, `"theirs"`, or `"ai_semantic"`.

### `POST /api/git/analyze-changes` *(Protected)*
Analyzes working tree changed files, computes risk classifications, and uses Groq LLM + GraphRAG to synthesize a multi-group logical commit plan.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "summary": "4 changed files grouped into 2 logical commits.",
    "totalFiles": 4,
    "totalCommits": 2,
    "groups": [
      {
        "id": "group-1",
        "name": "Auth Service",
        "reason": "Security and session expiration handling",
        "risk": "high",
        "files": ["src/auth/service.ts"],
        "suggestedCommit": {
          "type": "fix",
          "scope": "auth",
          "subject": "handle session expiration safely",
          "body": "Ensures token renewal without unhandled exceptions."
        }
      }
    ],
    "changedFiles": [
      {
        "filePath": "src/auth/service.ts",
        "status": "modified",
        "staged": false,
        "additions": 12,
        "deletions": 3,
        "risk": "high"
      }
    ]
  }
  ```

### `POST /api/git/commit-plan/execute` *(Protected)*
Executes the logical commit plan sequentially, staging only each group's files and verifying each resulting SHA.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "groups": [ /* LogicalChangeGroup[] from analyze-changes */ ]
  }
  ```

### `POST /api/git/commit-all` *(Protected)*
Analyzes working tree and executes the full logical commit plan in a single autonomous request.

### `POST /api/git/sync` *(Protected)*
Executes safe fetch followed by pull, verifying dirty tree safeguards before merging remote commits.

### `POST /api/git/ship` *(Protected)*
One-click autonomous shipping pipeline:
1. Analyzes working tree changes
2. Generates logical commit plan
3. Executes sequential atomic commits
4. Validates pre-push safety controls and branch protection
5. Pushes to remote repository
6. Automatically creates GitHub Pull Request (if GitHub token is configured)
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "branch": "feature/git-agent",
    "commitsCreated": 2,
    "push": { "success": true, "output": "..." },
    "pullRequest": { "number": 12, "url": "https://github.com/..." },
    "message": "Successfully analyzed, committed, pushed, and shipped pull request."
  }
  ```

---

## 8. Pull Requests & Issues Management Endpoints

### `GET /api/pr` *(Protected)*
Lists pull requests for a repository.
- **Query Parameters**: `?repositoryId=my-service&state=open|closed|all`
- **Response `200 OK`**:
  ```json
  {
    "pullRequests": [
      {
        "id": "pr-1",
        "number": 1,
        "title": "feat(git-agent): production hardening and modular views",
        "sourceBranch": "feature/git-agent",
        "targetBranch": "development",
        "status": "open",
        "author": "Harsh Pariya",
        "createdAt": "2026-09-07T08:00:00Z"
      }
    ]
  }
  ```

### `POST /api/pr` *(Protected)*
Creates a new pull request in the platform and syncs to GitHub if connected.
- **Request Body**:
  ```json
  {
    "repositoryId": "my-service",
    "title": "feat(git-agent): production git debugging agent",
    "sourceBranch": "feature/git-agent",
    "targetBranch": "development",
    "description": "Comprehensive production hardening with modular architecture."
  }
  ```

### `POST /api/pr/:id/merge` *(Protected)*
Merges a pull request using the specified merge strategy (`merge`, `squash`, `rebase`).
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Pull request #1 merged successfully into development."
  }
  ```

### `GET /api/github/repos/:owner/:repo/issues` *(Protected)*
Retrieves open or closed issues directly from the GitHub REST API for connected cloud repositories.

### `GET /api/github/repos/:owner/:repo/pulls` *(Protected)*
Retrieves pull requests directly from GitHub with diff and review statuses.

