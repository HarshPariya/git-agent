import http from "node:http";
import { app } from "../src/app.js";
import { connectDatabase, getDb, closeDatabase } from "../src/db/mongodb.js";

async function runSmokeTests(): Promise<void> {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
    "PRODUCTION SYSTEM END-TO-END SMOKE TEST SUITE\n" +
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, name: string): void => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    if (condition) {
      passed++;
    } else {
      failed++;
    }
  };

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to bind server port");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // ── 1. Application Infrastructure & Health ──────────────────────────────
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = (await healthRes.json()) as { status?: string };
    assert(healthRes.status === 200, "GET /health returns HTTP 200");
    assert(healthData.status === "ok" || healthData.status === "degraded", "Health reports valid operational status");

    const readyRes = await fetch(`${baseUrl}/ready`);
    assert(readyRes.status === 200 || readyRes.status === 503, "GET /ready responds with valid readiness probe code");

    const infoRes = await fetch(`${baseUrl}/api/info`);
    const infoData = (await infoRes.json()) as { service?: string; version?: string };
    assert(infoRes.status === 200, "GET /api/info returns HTTP 200");
    assert(infoData.service === "Git Debugging Agent", "Service identity is Git Debugging Agent");

    // ── 2. Database Connection & Ping ───────────────────────────────────────
    let dbConnected = false;
    try {
      await connectDatabase();
      const db = getDb();
      const pingResult = await db.command({ ping: 1 });
      dbConnected = Boolean(pingResult && pingResult.ok === 1);
    } catch {
      dbConnected = false;
    }
    assert(dbConnected, "MongoDB Atlas database connection verified with ping");

    // ── 3. Authentication Flow ──────────────────────────────────────────────
    const testEmail = `smoke_user_${Date.now()}@example.com`;
    const testPassword = "SmokePassword2026!";

    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: "Smoke Tester" }),
    });
    assert(registerRes.status === 200 || registerRes.status === 201, "User registration succeeds");
    const registerData = (await registerRes.json()) as { token?: string };
    const userToken = registerData.token ?? "";
    assert(Boolean(userToken && userToken.length > 20), "Registration returns valid JWT bearer token");

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const meData = (await meRes.json()) as { user?: { email?: string } };
    assert(meRes.status === 200, "GET /api/auth/me succeeds with bearer token");
    assert(meData.user?.email === testEmail, "Identity verification matches registered user email");

    // ── 4. Repository Store & Host Path Reconciliation ──────────────────────
    const connectRes = await fetch(`${baseUrl}/api/repositories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        name: "Git-Agent",
        localPath: process.cwd(),
      }),
    });
    assert(connectRes.status === 200 || connectRes.status === 201, "Repository connection API succeeds");
    const connectData = (await connectRes.json()) as { repository?: { id: string; localPath: string } };
    const repoId = connectData.repository?.id ?? "";
    assert(Boolean(repoId), "Connected repository assigned valid repository ID");

    const listRes = await fetch(`${baseUrl}/api/repositories`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const listData = (await listRes.json()) as {
      repositories?: Array<{ id: string; localPath: string; name: string }>;
    };
    const repos = listData.repositories ?? [];
    assert(repos.length > 0, "Repository list returns connected repositories");
    const connectedRepo = repos.find((r) => r.id === repoId || r.name === "Git-Agent");
    assert(Boolean(connectedRepo), "Connected Git-Agent repository present in active list");
    assert(!connectedRepo?.localPath.startsWith("/tmp/"), "Repository localPath is resolved to real host path");

    // ── 5. Git Desktop Live Operations & Branch Resolution ──────────────────
    const statusRes = await fetch(`${baseUrl}/api/git/status?repositoryId=${encodeURIComponent(repoId)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(statusRes.status === 200, "GET /api/git/status returns HTTP 200");
    const statusData = (await statusRes.json()) as { branch?: string; entries?: unknown[] };
    assert(
      Boolean(statusData.branch && statusData.branch !== "unknown"),
      `Live Git branch accurately detected (branch: "${statusData.branch}")`,
    );
    assert(Array.isArray(statusData.entries), "Git status entries returned as array");

    const logRes = await fetch(`${baseUrl}/api/git/log?repositoryId=${encodeURIComponent(repoId)}&count=5`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(logRes.status === 200, "GET /api/git/log returns HTTP 200");
    const logData = (await logRes.json()) as { commits?: Array<{ hash: string; message: string }> };
    assert(Array.isArray(logData.commits) && logData.commits.length > 0, "Git commit history contains valid commits");

    const diffRes = await fetch(`${baseUrl}/api/git/diff?repositoryId=${encodeURIComponent(repoId)}`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert(diffRes.status === 200, "GET /api/git/diff returns HTTP 200");

    // ── 6. AI Debugging Agent Pipeline ──────────────────────────────────────
    const startDebugRes = await fetch(`${baseUrl}/api/debug/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        repositoryId: repoId,
        query: "Smoke test investigation query",
        mode: "debug",
      }),
    });
    assert(startDebugRes.status === 201, "POST /api/debug/start initializes new debug session");
    const debugSession = (await startDebugRes.json()) as { id?: string; state?: string };
    const sessionId = debugSession.id ?? "";
    assert(Boolean(sessionId), "Debug session assigned unique session ID");

    const stepRes = await fetch(`${baseUrl}/api/debug/sessions/${sessionId}/step`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        stepType: "isolate",
        description: "Smoke test boundary isolation",
        query: "verify defect boundaries",
      }),
    });
    assert(stepRes.status === 200, "POST /api/debug/sessions/:id/step executes investigation step");

    // ── 7. Durability & MongoDB Persistence Verification ────────────────────
    if (dbConnected) {
      const db = getDb();
      const savedRepo = await db.collection("repositories").findOne({ id: repoId });
      assert(
        Boolean(savedRepo && savedRepo.status !== "disconnected"),
        "Repository persisted in MongoDB across requests",
      );

      const savedSession = await db.collection("debug_sessions").findOne({ id: sessionId });
      assert(Boolean(savedSession), "Debug session persisted in MongoDB debug_sessions collection");
    }

    console.log(
      `\n════════════════════════════════════════════════════\n` +
      `SMOKE TEST RESULTS: ${passed} Passed, ${failed} Failed.\n` +
      `════════════════════════════════════════════════════\n`,
    );

    if (failed > 0) {
      throw new Error(`Smoke test suite failed with ${failed} failure(s)`);
    }
  } finally {
    server.close();
    await closeDatabase().catch(() => { });
  }
}

runSmokeTests().catch((err) => {
  console.error("FATAL: Smoke test suite failed:", err);
  process.exit(1);
});
