/**
 * Unit & Integration Tests: n8n Automation & Internal Endpoints
 * Tests authentication, payload validation, triage, CI diagnostics, PR review, and secret protection.
 */

import http from "node:http";
import express from "express";
import {
  n8nIssueTriageHandler,
  n8nCiFailureHandler,
  n8nPrReviewHandler,
  n8nCiResultHandler,
  n8nPostCommitHandler,
} from "../src/api/automation/n8n.js";
import { isSensitiveFilePath, redactSecrets, scanContentForSecrets } from "../src/guardrails/secrets-scanner.js";

async function runTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("n8n AUTOMATION & INTERNAL ENDPOINTS TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let passed = 0;
  let failed = 0;
  const assert = (condition: boolean, name: string) => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? passed++ : failed++;
  };

  // 1. Secrets Scanner Tests
  console.log("▶ 1. Secrets Scanner Verification");
  assert(isSensitiveFilePath(".env") === true, ".env is marked sensitive");
  assert(isSensitiveFilePath(".env.production") === true, ".env.production is marked sensitive");
  assert(isSensitiveFilePath("src/config/.env.local") === true, "Nested .env is marked sensitive");
  assert(isSensitiveFilePath("credentials.json") === true, "credentials.json is marked sensitive");
  assert(isSensitiveFilePath("server.key") === true, "server.key is marked sensitive");
  assert(isSensitiveFilePath("src/app.ts") === false, "src/app.ts is safe");

  const sampleWithSecret = "const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'; const other = 123;";
  const redacted = redactSecrets(sampleWithSecret);
  assert(!redacted.includes("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "Secret is redacted in output");
  assert(redacted.includes("[REDACTED_SECRET]"), "Redaction replacement string is present");

  const scanResult = scanContentForSecrets(
    "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----",
    "private.key",
  );
  assert(!scanResult.clean && scanResult.matches.length > 0, "Private key detected by scanner");

  // 2. Setup Express test app for n8n automation endpoints
  console.log("\n▶ 2. Internal Endpoints Authentication & Logic");
  const testKey = "test-n8n-automation-secret-key-1234";
  process.env.N8N_API_KEY = testKey;

  const app = express();
  app.use(express.json());
  app.post("/api/internal/automation/issue-triage", n8nIssueTriageHandler);
  app.post("/api/internal/automation/ci-failure", n8nCiFailureHandler);
  app.post("/api/internal/automation/pr-review", n8nPrReviewHandler);
  app.post("/api/internal/automation/ci-result", n8nCiResultHandler);
  app.post("/api/internal/automation/post-commit", n8nPostCommitHandler);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || err.status || 500).json({ error: err.message });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const baseUrl = `http://localhost:${port}`;

  const requestHelper = async (endpoint: string, headers: Record<string, string>, body: any) => {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    let data: any = {};
    try {
      data = await res.json();
    } catch (_) {}
    return { status: res.status, data };
  };

  try {
    // 2.1 Authentication Enforcement
    const unauth = await requestHelper(
      "/api/internal/automation/issue-triage",
      {},
      { repository: "test/repo", issueNumber: 1, title: "Test", body: "Something broke" },
    );
    assert(unauth.status === 401, "Unauthenticated request without X-N8N-Key returns 401");

    const invalidAuth = await requestHelper(
      "/api/internal/automation/issue-triage",
      { "X-N8N-Key": "wrong-key" },
      { repository: "test/repo", issueNumber: 1, title: "Test", body: "Something broke" },
    );
    assert(invalidAuth.status === 401, "Invalid X-N8N-Key returns 401");

    // 2.2 Issue Triage Endpoint
    const triageRes = await requestHelper(
      "/api/internal/automation/issue-triage",
      { "X-N8N-Key": testKey },
      {
        repository: "my-org/my-project",
        issueNumber: 42,
        title: "Crash when parsing JSON response",
        body: "TypeError: Cannot read properties of undefined in parser.ts line 14",
        author: "dev-user",
      },
    );
    assert(triageRes.status === 200, "Issue triage endpoint returns 200");
    assert(triageRes.data.classification === "bug", "Bug is accurately classified");
    assert(Array.isArray(triageRes.data.suggestedLabels), "Suggested labels array returned");
    assert(typeof triageRes.data.initialAnalysis === "string", "Initial analysis text generated");

    // 2.3 CI Failure Endpoint
    const ciFailureRes = await requestHelper(
      "/api/internal/automation/ci-failure",
      { "X-N8N-Key": testKey },
      {
        repository: "my-org/my-project",
        runId: "123456",
        commitSha: "a1b2c3d4e5f6",
        branch: "main",
        failureLogs: "Error: expected 200 but got 500 at app.test.ts:32",
      },
    );
    assert(ciFailureRes.status === 200, "CI failure endpoint returns 200");
    assert(ciFailureRes.data.diagnosed === true, "CI failure is diagnosed");
    assert(typeof ciFailureRes.data.rootCause === "string", "Root cause identified");
    assert(typeof ciFailureRes.data.suggestedFix === "string", "Suggested fix provided");

    // 2.4 PR Review Endpoint
    const prReviewRes = await requestHelper(
      "/api/internal/automation/pr-review",
      { "X-N8N-Key": testKey },
      {
        repository: "my-org/my-project",
        pullRequestId: 10,
        title: "feat: add user authentication handler",
        description: "Implements JWT session validation with secret verification",
        headSha: "f6e5d4c3b2a1",
        baseRef: "main",
      },
    );
    assert(prReviewRes.status === 200, "PR review endpoint returns 200");
    assert(typeof prReviewRes.data.approved === "boolean", "Review approval verdict returned");
    assert(typeof prReviewRes.data.summary === "string", "Review summary returned");

    // 2.5 CI Result Endpoint
    const ciResultRes = await requestHelper(
      "/api/internal/automation/ci-result",
      { "X-N8N-Key": testKey },
      {
        repository: "my-org/my-project",
        pullRequestId: 10,
        commitSha: "f6e5d4c3b2a1",
        checkName: "unit-tests",
        status: "success",
      },
    );
    assert(ciResultRes.status === 200, "CI result endpoint returns 200");
    assert(ciResultRes.data.processed === true, "CI result processed");
    assert(ciResultRes.data.actionRequired === "none", "Passing CI requires no remediation");

    // 2.6 Post-Commit Endpoint
    const postCommitRes = await requestHelper(
      "/api/internal/automation/post-commit",
      { "X-N8N-Key": testKey },
      {
        repository: "my-org/my-project",
        branch: "main",
        commitHash: "9876543210abcdef",
        commitMessage: "fix(core): resolve null pointer in event dispatcher",
        author: "Lead Dev",
      },
    );
    assert(postCommitRes.status === 200, "Post-commit endpoint returns 200");
    assert(postCommitRes.data.recorded === true, "Commit recorded successfully");
    assert(postCommitRes.data.commitHash === "9876543210abcdef", "Commit hash preserved");
    assert(postCommitRes.data.ciTriggered === true, "CI triggered for main branch commit");
  } finally {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Test failed with exception:", err);
  process.exit(1);
});
