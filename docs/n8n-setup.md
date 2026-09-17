# n8n Automation & Webhook Integration Guide

This guide details how to connect and automate **Git Agent** with **n8n** running on your self-hosted or cloud instance (e.g., `http://<n8n.ip>:5678`).

---

## 1. Architecture Overview

```
GitHub Webhooks (Issues, PRs, CI Actions)
                     │
                     ▼
          ┌─────────────────────┐
          │   n8n.ip Platform   │
          │   (5 Workflows)     │
          └──────────┬──────────┘
                     │  X-N8N-Key Authenticated HTTP
                     ▼
          ┌─────────────────────┐
          │  Git Agent Backend  │
          │  /api/internal/     │
          │     automation/*    │
          └──────────┬──────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
Groq AI Critic & Planner    Browser Git Desktop
(Diagnostic Patches)       (User Local PC Folders)
```

---

## 2. Environment Configuration

### In Git Agent (`.env` on Render / Server)
```env
N8N_API_KEY=your_secure_n8n_secret_key_here
N8N_WEBHOOK_URL=http://<n8n.ip>:5678/webhook
N8N_WEBHOOK_SECRET=your_n8n_webhook_hmac_secret
```

### In n8n Platform (`Settings` -> `Variables` or `.env` file)
| Variable Name | Description | Example |
| :--- | :--- | :--- |
| `GIT_AGENT_URL` | Base URL of your deployed Git Agent | `https://git-agent.onrender.com` |
| `N8N_API_KEY` | Must match the `N8N_API_KEY` in Git Agent | `your_secure_n8n_secret_key_here` |
| `GITHUB_TOKEN` | GitHub Personal Access Token with repo scope | `ghp_xxxxxxxxxxxx` |

---

## 3. Step-by-Step Instructions: What to do in your `n8n.ip` Website

Follow these exact steps when opening your `http://<n8n.ip>:5678` web interface:

### Step 1: Log in to your n8n Dashboard
Open `http://<n8n.ip>:5678` in your browser and log in with your administrative credentials.

### Step 2: Configure Environment Variables
1. In the left navigation sidebar, click **Variables** (or gear icon ⚙️ -> **Variables**).
2. Click **Add Variable** and create these three entries:
   - `GIT_AGENT_URL`: `https://git-agent.onrender.com` (or your actual server URL)
   - `N8N_API_KEY`: The exact key string you set in your Git Agent `.env`
   - `GITHUB_TOKEN`: Your GitHub Personal Access Token (`ghp_...`)

### Step 3: Option A — Import Ready-to-Use Workflows (Fastest)
The repository includes 5 ready-to-run workflow JSON files under `n8n/workflows/`:
1. `n8n/workflows/1-github-issue-triage.json`
2. `n8n/workflows/2-ci-failure-debugging.json`
3. `n8n/workflows/3-pr-review.json`
4. `n8n/workflows/4-pr-ci-loop.json`
5. `n8n/workflows/5-post-commit-automation.json`

**To import them into n8n:**
1. Click **Workflows** in the left sidebar.
2. Click the **⋮** (three dots) menu in the upper right, then click **Import from File**.
3. Select any or all 5 workflow `.json` files.
4. Toggle the workflow status switch in the upper right from **Inactive** to **Active**.
5. Copy the **Webhook URL** shown in the Webhook node (e.g., `http://<n8n.ip>:5678/webhook/github-issue-triage`).

### Step 4: Configure Webhook in your GitHub Repository
1. In GitHub, go to your repository -> **Settings** -> **Webhooks** -> **Add webhook**.
2. **Payload URL**: Paste the n8n Webhook URL from Step 3.
3. **Content type**: Select `application/json`.
4. **Which events would you like to trigger this webhook?**: Select *Let me select individual events*:
   - Check **Issues**
   - Check **Pull requests**
   - Check **Workflow runs**
   - Check **Check runs**
5. Click **Add webhook**.

---

## 4. The Exact Prompt for n8n AI (Copy & Paste into n8n AI Assistant)

If you are using the **n8n AI Workflow Builder** on your `n8n.ip` instance, copy and paste the exact prompt below into the n8n AI chat prompt box:

```text
Build an end-to-end Git Agent automation system with 5 event-driven workflows connecting GitHub and our Git-Agent server:

SERVER CONFIGURATION:
- Git Agent Base URL: {{$env.GIT_AGENT_URL}}
- Authentication Header: X-N8N-Key: {{$env.N8N_API_KEY}}
- GitHub API Base URL: https://api.github.com
- GitHub Auth Header: Authorization: Bearer {{$env.GITHUB_TOKEN}}

CREATE THE FOLLOWING 5 WORKFLOWS:

WORKFLOW 1 - GitHub Issue Triage Automation:
1. Webhook trigger on path 'github-issue-triage' receiving GitHub issue events.
2. IF node checking if action is 'opened'.
3. HTTP Request node calling POST {{$env.GIT_AGENT_URL}}/api/internal/automation/issue-triage with headers:
   - Content-Type: application/json
   - X-N8N-Key: {{$env.N8N_API_KEY}}
   And JSON body:
   {
     "repository": "{{$json.body.repository.full_name}}",
     "issueNumber": {{$json.body.issue.number}},
     "title": "{{$json.body.issue.title}}",
     "body": "{{$json.body.issue.body}}",
     "author": "{{$json.body.issue.user.login}}"
   }
4. IF node checking if response.classification is 'bug'.
5. If true, HTTP Request to GitHub API POST /repos/{{$json.repository}}/issues/{{$json.issueNumber}}/comments posting the AI triage analysis report and suggested labels.

WORKFLOW 2 - CI Failure Debugging Automation:
1. Webhook trigger on path 'ci-failure-webhook' receiving GitHub workflow_run or check_run failures.
2. IF node verifying conclusion is 'failure'.
3. HTTP Request node calling POST {{$env.GIT_AGENT_URL}}/api/internal/automation/ci-failure with:
   {
     "repository": "{{$json.body.repository.full_name}}",
     "runId": "{{$json.body.workflow_run.id}}",
     "commitSha": "{{$json.body.workflow_run.head_sha}}",
     "branch": "{{$json.body.workflow_run.head_branch}}",
     "failureLogs": "{{$json.body.logs || 'CI failure'}}"
   }
4. IF node checking if response.diagnosed is true.
5. If true, HTTP Request to GitHub API creating a commit comment or PR comment with the diagnosed root cause and auto-fix patch diff.

WORKFLOW 3 - Automated PR Review & Semantic Check:
1. Webhook trigger on path 'github-pr-review' receiving pull_request events ('opened', 'synchronize').
2. HTTP Request node calling POST {{$env.GIT_AGENT_URL}}/api/internal/automation/pr-review with:
   {
     "repository": "{{$json.body.repository.full_name}}",
     "pullRequestId": {{$json.body.pull_request.number}},
     "title": "{{$json.body.pull_request.title}}",
     "description": "{{$json.body.pull_request.body}}",
     "headSha": "{{$json.body.pull_request.head.sha}}",
     "baseRef": "{{$json.body.pull_request.base.ref}}"
   }
3. HTTP Request to GitHub API POST /repos/{{$json.repository}}/pulls/{{$json.pullRequestId}}/reviews submitting review verdict (APPROVE or COMMENT) with AI feedback summary.

WORKFLOW 4 - PR CI Loop & Automated Remediation:
1. Webhook trigger on path 'pr-ci-loop' receiving CI completion results.
2. HTTP Request node calling POST {{$env.GIT_AGENT_URL}}/api/internal/automation/ci-result.
3. IF node checking if response.actionRequired is 'debug_and_patch'.
4. If true, trigger the CI failure diagnostic pipeline to synthesize a patch.

WORKFLOW 5 - Post-Commit Automation & Notifications:
1. Webhook trigger on path 'post-commit-webhook' receiving internal Git Agent post-commit events.
2. HTTP Request node calling POST {{$env.GIT_AGENT_URL}}/api/internal/automation/post-commit with commit metadata.
3. Parse Conventional Commit prefix and dispatch appropriate notification or GitHub Actions workflow dispatch.

Ensure all HTTP Request nodes have appropriate error handling and JSON validation.
```

---

## 5. Security & Secret Safeguards

1. **Authentication**: All endpoints under `/api/internal/automation/*` strictly require `X-N8N-Key` matching `N8N_API_KEY`. Unauthenticated requests return `401 Unauthorized`.
2. **Payload Validation**: All inputs are validated with strict schema parsing. Missing required fields return `400 Bad Request`.
3. **Secret Redaction**: Any diff, stack trace, or log processed by Git Agent is scanned through the `SecretScanner` to ensure AWS keys, GitHub tokens, Slack tokens, and private keys are never exposed in webhook responses or sent to public APIs.
