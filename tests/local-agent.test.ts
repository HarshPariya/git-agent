/* eslint-disable no-console */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLocalAgentServer } from "../apps/local-agent/src/server.js";
import type { LocalAgentConfig } from "../apps/local-agent/src/types.js";

const execFileAsync = promisify(execFile);

describe("Local Companion Agent Test Suite", () => {
  let serverInstance: ReturnType<typeof createLocalAgentServer>;
  let testPort: number;
  let testBaseUrl: string;
  let pairingToken: string;
  let tempRepoDir: string;

  const testConfig: LocalAgentConfig = {
    host: "127.0.0.1",
    port: 41788,
    allowedOrigins: ["http://127.0.0.1:41788", "http://localhost:3000", "null"],
    tokenExpiryHours: 24,
    tokenFilePath: path.join(os.tmpdir(), "test-local-agent-token.json"),
  };

  before(async () => {
    testPort = testConfig.port;
    testBaseUrl = `http://127.0.0.1:${testPort}`;
    pairingToken = "a".repeat(64);

    // Write pairing token file
    await fs.writeFile(
      testConfig.tokenFilePath,
      JSON.stringify({ token: pairingToken, createdAt: new Date().toISOString() }),
      "utf-8",
    );

    // Create real local git repository in temp directory
    tempRepoDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-agent-repo-"));
    await execFileAsync("git", ["init", "-b", "main"], { cwd: tempRepoDir });
    await execFileAsync("git", ["config", "user.name", "Test User"], { cwd: tempRepoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: tempRepoDir });

    // Commit initial file
    const readmePath = path.join(tempRepoDir, "README.md");
    await fs.writeFile(readmePath, "# Initial Repo\n", "utf-8");
    await execFileAsync("git", ["add", "README.md"], { cwd: tempRepoDir });
    await execFileAsync("git", ["commit", "-m", "chore: initial commit"], { cwd: tempRepoDir });

    // Start server
    serverInstance = createLocalAgentServer(testConfig);
    await serverInstance.start();
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.stop();
    }
    // Cleanup files
    try {
      await fs.unlink(testConfig.tokenFilePath);
    } catch {
      // Ignore
    }
    try {
      await fs.rm(tempRepoDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("GET /health returns 200 with platform and git status", async () => {
    const res = await fetch(`${testBaseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: string; gitInstalled: boolean; platform: string };
    assert.equal(body.status, "ok");
    assert.equal(body.gitInstalled, true);
    assert.ok(body.platform);
  });

  it("POST /pair fails with invalid token and succeeds with valid token", async () => {
    const badRes = await fetch(`${testBaseUrl}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "wrong_token" }),
    });
    assert.equal(badRes.status, 401);

    const okRes = await fetch(`${testBaseUrl}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: pairingToken }),
    });
    assert.equal(okRes.status, 200);
    const body = (await okRes.json()) as { paired: boolean };
    assert.equal(body.paired, true);
  });

  it("Enforces bearer token authentication on protected endpoints", async () => {
    const unauthRes = await fetch(`${testBaseUrl}/repos/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempRepoDir }),
    });
    assert.equal(unauthRes.status, 401);

    const authRes = await fetch(`${testBaseUrl}/repos/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir }),
    });
    assert.equal(authRes.status, 200);
    const body = (await authRes.json()) as { isGit: boolean; branch: string };
    assert.equal(body.isGit, true);
    assert.equal(body.branch, "main");
  });

  it("POST /repos/status reflects live working tree modifications", async () => {
    const testFile = path.join(tempRepoDir, "src", "index.ts");
    await fs.mkdir(path.dirname(testFile), { recursive: true });
    await fs.writeFile(testFile, "console.log('Hello Local Agent');\n", "utf-8");

    const res = await fetch(`${testBaseUrl}/repos/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { status: { clean: boolean; entries: Array<{ filePath: string }> } };
    assert.equal(body.status.clean, false);
    assert.ok(body.status.entries.some((e) => e.filePath.includes("src/index.ts")));
  });

  it("POST /repos/stage, /repos/diff, and /repos/commit create verified commit", async () => {
    const stageRes = await fetch(`${testBaseUrl}/repos/stage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir, files: ["src/index.ts"] }),
    });
    assert.equal(stageRes.status, 200);

    const diffRes = await fetch(`${testBaseUrl}/repos/diff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir, filePath: "src/index.ts", staged: true }),
    });
    assert.equal(diffRes.status, 200);
    const diffBody = (await diffRes.json()) as { diff: string };
    assert.ok(diffBody.diff.includes("Hello Local Agent"));

    const commitRes = await fetch(`${testBaseUrl}/repos/commit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir, message: "feat(core): add main entrypoint" }),
    });
    assert.equal(commitRes.status, 200);
    const commitBody = (await commitRes.json()) as { commitHash: string };
    assert.ok(commitBody.commitHash);

    // Verify status is clean after commit
    const statusRes = await fetch(`${testBaseUrl}/repos/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir }),
    });
    const statusBody = (await statusRes.json()) as { status: { clean: boolean } };
    assert.equal(statusBody.status.clean, true);
  });

  it("POST /repos/branches, /create, and /checkout switch branches", async () => {
    const createRes = await fetch(`${testBaseUrl}/repos/branches/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir, branch: "feature/test-branch" }),
    });
    assert.equal(createRes.status, 200);

    const listRes = await fetch(`${testBaseUrl}/repos/branches`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir }),
    });
    const listBody = (await listRes.json()) as { branches: Array<{ name: string; current: boolean }> };
    assert.ok(listBody.branches.some((b) => b.name === "feature/test-branch"));

    const checkoutRes = await fetch(`${testBaseUrl}/repos/branches/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({ path: tempRepoDir, branch: "main" }),
    });
    assert.equal(checkoutRes.status, 200);
  });

  it("POST /repos/patch/apply and /revert safely modifies and restores files", async () => {
    const targetFile = "src/index.ts";
    const patchedContent = "console.log('Patched via Local Agent');\n";

    const applyRes = await fetch(`${testBaseUrl}/repos/patch/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({
        path: tempRepoDir,
        changes: [{ filePath: targetFile, content: patchedContent }],
      }),
    });
    assert.equal(applyRes.status, 200);
    const applyBody = (await applyRes.json()) as { success: boolean; backupId: string };
    assert.equal(applyBody.success, true);
    assert.ok(applyBody.backupId);

    // Verify file content was patched
    const fullTarget = path.join(tempRepoDir, targetFile);
    const contentAfterApply = await fs.readFile(fullTarget, "utf-8");
    assert.equal(contentAfterApply, patchedContent);

    // Revert
    const revertRes = await fetch(`${testBaseUrl}/repos/patch/revert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({
        path: tempRepoDir,
        backupId: applyBody.backupId,
      }),
    });
    assert.equal(revertRes.status, 200);

    const contentAfterRevert = await fs.readFile(fullTarget, "utf-8");
    assert.equal(contentAfterRevert, "console.log('Hello Local Agent');\n");
  });

  it("POST /repos/test runs process commands securely and captures output", async () => {
    const testRes = await fetch(`${testBaseUrl}/repos/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({
        path: tempRepoDir,
        command: "node -e \"console.log('Local test suite passed'); process.exit(0);\"",
      }),
    });
    assert.equal(testRes.status, 200);
    const testBody = (await testRes.json()) as { success: boolean; exitCode: number; stdout: string };
    assert.equal(testBody.success, true);
    assert.equal(testBody.exitCode, 0);
    assert.ok(testBody.stdout.includes("Local test suite passed"));
  });
});
