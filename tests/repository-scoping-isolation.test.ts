import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { contextBuilder } from "../src/agent/context-builder.js";
import { debugAgentPipeline } from "../src/agent/debug-agent.js";
import { getExecutionPath, registerRepositoryPath } from "../src/git/engine.js";
import type { RepositoryContext } from "../src/types/repository-context.js";

async function runScopingIsolationTests() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "REPOSITORY SCOPING & ISOLATION TEST SUITE\n" +
      "Verifying zero silent fallbacks and single source of truth\n" +
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0;
  let failed = 0;
  const assert = (condition: boolean, name: string) => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? passed++ : failed++;
  };

  // 1. Zero silent fallback in getExecutionPath
  console.log("\n▶ 1. Execution Path Strict Scoping");
  let caughtFallback = false;
  try {
    getExecutionPath("non-existent-arbitrary-repo-id");
  } catch (err: any) {
    caughtFallback = true;
    assert(
      err.message.includes("not found") ||
        err.message.includes("inaccessible") ||
        err.message.includes("REPOSITORY_REQUIRED"),
      "getExecutionPath throws explicit error for unknown repository instead of process.cwd()",
    );
  }
  assert(caughtFallback, "Unknown repository lookup must reject, never silent fallback");

  // 2. Client-provided local repository context (e.g. Task-3-Agent-Loop)
  console.log("\n▶ 2. Context Builder Scoping: Task-3-Agent-Loop vs Git-Agent");

  const task3Context: RepositoryContext = {
    repositoryId: "repo-task-3",
    workspaceId: "ws_repo-task-3",
    mode: "LOCAL",
    displayName: "Task-3-Agent-Loop",
    rootIdentifier: "Task-3-Agent-Loop",
    branch: "feature/loop-agent",
    fileManifest: [
      { path: "agent_loop.py", type: "SOURCE", language: "python", size: 1024 },
      { path: "tests/test_loop.py", type: "TEST", language: "python", size: 512 },
      { path: "requirements.txt", type: "CONFIG", language: "plaintext", size: 80 },
    ],
    manifestSummary: {
      totalFiles: 3,
      sourceFiles: 1,
      testFiles: 1,
      configFiles: 1,
      docFiles: 0,
      ciFiles: 0,
      ignoredFiles: 0,
      detectedLanguages: ["python"],
    },
    gitSnapshot: {
      branch: "feature/loop-agent",
      clean: true,
      ahead: 1,
      behind: 0,
      changedFiles: ["agent_loop.py"],
      diff: "diff --git a/agent_loop.py b/agent_loop.py\n+def loop_agent(): pass",
      recentCommits: "abc1234 feat: implement agent loop",
    },
    indexedAt: new Date().toISOString(),
  };

  const builtContext = await contextBuilder.build({
    repositoryId: "repo-task-3",
    tenantId: "tenant-scoping-test",
    query: "Debug loop termination condition in Task-3-Agent-Loop",
    repositoryContext: task3Context,
  });

  assert(
    builtContext.repositoryName === "Task-3-Agent-Loop",
    "Context repositoryName matches selected repository 'Task-3-Agent-Loop'",
  );
  assert(
    builtContext.git.branch === "feature/loop-agent",
    "Context branch matches selected repository branch ('feature/loop-agent')",
  );
  assert(
    builtContext.git.recentCommits === "abc1234 feat: implement agent loop",
    "Context git commits match selected repository snapshot",
  );
  assert(builtContext.git.diff?.includes("def loop_agent"), "Context diff reflects selected repository diff");

  // Ensure Git-Agent host files (e.g. package.json, src/app.ts, tsconfig.json) are NEVER present in Task-3 context
  const hasGitAgentFiles = builtContext.code.relevantFiles.some(
    (f) => f.includes("src/app.ts") || f.includes("package.json") || f.includes("tsconfig.json"),
  );
  assert(!hasGitAgentFiles, "Task-3-Agent-Loop context contains ZERO Git-Agent source/config files");

  assert(
    builtContext.code.relevantFiles.some((f) => f.includes("agent_loop.py")),
    "Task-3-Agent-Loop context contains Task-3's agent_loop.py",
  );

  const promptText = contextBuilder.toPrompt(builtContext);
  assert(
    promptText.includes("REPOSITORY: Task-3-Agent-Loop (repo-task-3)"),
    "Prompt header contains Task-3-Agent-Loop identity",
  );
  assert(!promptText.includes("Git-Agent"), "Prompt text has NO references to Git-Agent host repository");

  // 3. Multi-Session Strict Isolation
  console.log("\n▶ 3. Multi-Session Scoping & Memory Isolation");

  const session1 = debugAgentPipeline.startSession(
    "repo-task-3",
    "tenant-iso",
    "user-1",
    "debug",
    "Debug Task 3",
    task3Context,
  );

  assert(
    session1.repositoryContext?.displayName === "Task-3-Agent-Loop",
    "Session 1 stores Task-3-Agent-Loop repository context",
  );

  const anotherRepoContext: RepositoryContext = {
    repositoryId: "repo-ecommerce-api",
    workspaceId: "ws_repo-ecommerce-api",
    mode: "LOCAL",
    displayName: "Ecommerce-API",
    rootIdentifier: "Ecommerce-API",
    branch: "main",
    fileManifest: [{ path: "src/server.go", type: "SOURCE", language: "go", size: 2048 }],
    manifestSummary: {
      totalFiles: 1,
      sourceFiles: 1,
      testFiles: 0,
      configFiles: 0,
      docFiles: 0,
      ciFiles: 0,
      ignoredFiles: 0,
      detectedLanguages: ["go"],
    },
    gitSnapshot: {
      branch: "main",
      clean: true,
      changedFiles: [],
    },
    indexedAt: new Date().toISOString(),
  };

  const session2 = debugAgentPipeline.startSession(
    "repo-ecommerce-api",
    "tenant-iso",
    "user-1",
    "debug",
    "Debug Ecommerce API",
    anotherRepoContext,
  );

  assert(
    session2.repositoryContext?.displayName === "Ecommerce-API",
    "Session 2 stores Ecommerce-API repository context",
  );

  // Verify retrieving sessions from pipeline maintains isolation
  const retrievedS1 = debugAgentPipeline.getSession(session1.id, "tenant-iso");
  const retrievedS2 = debugAgentPipeline.getSession(session2.id, "tenant-iso");

  assert(
    retrievedS1?.repositoryContext?.displayName === "Task-3-Agent-Loop",
    "Retrieved Session 1 is isolated to Task-3-Agent-Loop",
  );
  assert(
    retrievedS2?.repositoryContext?.displayName === "Ecommerce-API",
    "Retrieved Session 2 is isolated to Ecommerce-API",
  );
  assert(
    retrievedS1?.repositoryContext?.repositoryId !== retrievedS2?.repositoryContext?.repositoryId,
    "Session repository IDs are strictly distinct",
  );

  // 4. Temporary on-disk repository registration isolation
  console.log("\n▶ 4. Isolated On-Disk Workspace Verification");

  const tmpDirA = await fs.mkdtemp(path.join(os.tmpdir(), "git-agent-iso-a-"));
  const tmpDirB = await fs.mkdtemp(path.join(os.tmpdir(), "git-agent-iso-b-"));

  try {
    await fs.writeFile(path.join(tmpDirA, "unique-to-a.txt"), "hello A");
    await fs.writeFile(path.join(tmpDirB, "unique-to-b.txt"), "hello B");

    // Initialize git in test workspaces
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    await execAsync("git init", { cwd: tmpDirA });
    await execAsync(
      "git config user.name test && git config user.email test@example.com && git add . && git commit -m initial",
      { cwd: tmpDirA },
    );
    await execAsync("git init", { cwd: tmpDirB });
    await execAsync(
      "git config user.name test && git config user.email test@example.com && git add . && git commit -m initial",
      { cwd: tmpDirB },
    );

    registerRepositoryPath("test-repo-a", tmpDirA);
    registerRepositoryPath("test-repo-b", tmpDirB);

    const pathA = getExecutionPath("test-repo-a");
    const pathB = getExecutionPath("test-repo-b");

    assert(pathA === tmpDirA, "getExecutionPath('test-repo-a') resolves strictly to tmpDirA");
    assert(pathB === tmpDirB, "getExecutionPath('test-repo-b') resolves strictly to tmpDirB");

    const ctxA = await contextBuilder.build({
      repositoryId: "test-repo-a",
      tenantId: "tenant-iso",
      query: "find unique-to-a",
    });

    const ctxB = await contextBuilder.build({
      repositoryId: "test-repo-b",
      tenantId: "tenant-iso",
      query: "find unique-to-b",
    });

    assert(
      ctxA.code.relevantFiles.some((f) => f.includes("unique-to-a.txt")),
      "ctxA includes unique-to-a.txt",
    );
    assert(
      !ctxA.code.relevantFiles.some((f) => f.includes("unique-to-b.txt")),
      "ctxA DOES NOT include unique-to-b.txt (zero cross-repo bleeding)",
    );
    assert(
      ctxB.code.relevantFiles.some((f) => f.includes("unique-to-b.txt")),
      "ctxB includes unique-to-b.txt",
    );
    assert(
      !ctxB.code.relevantFiles.some((f) => f.includes("unique-to-a.txt")),
      "ctxB DOES NOT include unique-to-a.txt (zero cross-repo bleeding)",
    );
  } finally {
    await fs.rm(tmpDirA, { recursive: true, force: true }).catch(() => {});
    await fs.rm(tmpDirB, { recursive: true, force: true }).catch(() => {});
  }

  console.log(`\n════════════════════════════════════════════════════`);
  console.log(`SCOPING & ISOLATION RESULTS: ${passed} Passed, ${failed} Failed.`);
  console.log(`════════════════════════════════════════════════════\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runScopingIsolationTests().catch((err) => {
  console.error("Test suite threw uncaught error:", err);
  process.exit(1);
});
