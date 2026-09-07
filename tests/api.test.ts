import http from "node:http";
import { app } from "../src/app.js";

async function runApiTests() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("EXPRESS API & SERVICE ENDPOINT TEST SUITE");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✓ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // Start HTTP server on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to get server port");
  }
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    // 1. Health & Readiness (public endpoints)
    const healthRes = await fetch(`${baseUrl}/health`);
    const healthData = await healthRes.json() as any;
    assert(healthRes.status === 200, "GET /health returns HTTP 200");
    assert(healthData.status === "ok" || healthData.status === "degraded", "GET /health reports valid status");

    const readyRes = await fetch(`${baseUrl}/ready`);
    const readyData = await readyRes.json() as any;
    assert(readyRes.status === 200 || readyRes.status === 503, "GET /ready returns valid probe code (200/503)");
    assert(Boolean(readyData.status), "GET /ready reports probe status");

    const infoRes = await fetch(`${baseUrl}/api/info`);
    const infoData = await infoRes.json() as any;
    assert(infoRes.status === 200, "GET /api/info returns HTTP 200");
    assert(Boolean(infoData.service), "GET /api/info returns service metadata");

    // 2. Auth: Register, Login, Me
    const testEmail = `ci_tester_${Date.now()}@example.com`;
    const testPassword = "SecurePassword123!";

    const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "CI Tester",
      }),
    });
    const registerData = await registerRes.json() as any;
    assert(registerRes.status === 200 || registerRes.status === 201, "POST /api/auth/register returns 200/201");
    assert(Boolean(registerData.token), "Register returns valid JWT token");

    const token = registerData.token;

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meData = await meRes.json() as any;
    assert(meRes.status === 200, "GET /api/auth/me returns HTTP 200 with Bearer token");
    assert(meData.user?.email === testEmail, "GET /api/auth/me returns registered user email");

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    const loginData = await loginRes.json() as any;
    assert(loginRes.status === 200, "POST /api/auth/login returns HTTP 200");
    assert(Boolean(loginData.token), "Login returns valid JWT token");

    // 3. Git Operations Catalog & Classification (authenticated)
    const opsRes = await fetch(`${baseUrl}/api/git/catalog`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const opsData = await opsRes.json() as any;
    assert(opsRes.status === 200, "GET /api/git/catalog returns HTTP 200");
    assert(Array.isArray(opsData) && opsData.length >= 10, "Operations catalog lists git operations");

    const classifyRes = await fetch(`${baseUrl}/api/git/classify/push`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const classifyData = await classifyRes.json() as any;
    assert(classifyRes.status === 200, "GET /api/git/classify/push returns HTTP 200");
    assert(classifyData.risk === "dangerous", "Push operation classified as dangerous");

    // 4. Repositories
    const reposRes = await fetch(`${baseUrl}/api/repositories`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const reposData = await reposRes.json() as any;
    assert(reposRes.status === 200, "GET /api/repositories returns HTTP 200");
    assert(Array.isArray(reposData.repositories), "Returns repositories array");

    // 5. Filesystem Browser
    const cwdEncoded = encodeURIComponent(process.cwd());
    const fsRes = await fetch(`${baseUrl}/api/fs/browse?path=${cwdEncoded}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const fsData = await fsRes.json() as any;
    assert(fsRes.status === 200, "GET /api/fs/browse returns HTTP 200");
    assert(fsData.isGitRepo === true, "Filesystem browser detects git repository");
    assert(
      Array.isArray(fsData.directories) && Array.isArray(fsData.files),
      "Filesystem browser returns directories and files arrays",
    );
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`API TEST RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runApiTests().catch((err) => {
  console.error("API test failed:", err);
  process.exitCode = 1;
});
