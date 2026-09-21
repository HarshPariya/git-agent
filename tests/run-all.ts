import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const SUITE_TIMEOUT_MS = 60_000;

interface TestSuite {
  name: string;
  file: string;
  timeoutMs?: number;
}

const SUITES: TestSuite[] = [
  { name: "Git Engine & Safety Controls", file: "tests/git-engine.test.ts" },
  { name: "Agent Orchestration & State Machine", file: "tests/agent-orchestrator.test.ts" },
  { name: "Express API & Service Endpoints", file: "tests/api.test.ts" },
  { name: "Guardrails, Security & Limits", file: "tests/guardrails.test.ts" },
  { name: "AI Semantic Commit Plan & Change Analyzer", file: "tests/git-change-analyzer.test.ts" },
  { name: "E2E Git Workflow & Synchronization", file: "tests/e2e-git-workflow.test.ts" },
  { name: "Multi-Tenant Isolation & Restart Recovery", file: "tests/tenant-and-recovery.test.ts" },
  { name: "n8n Automation & Internal Endpoints", file: "tests/n8n-automation.test.ts", timeoutMs: 90_000 },
  { name: "Repository Scoping & Workspace Isolation", file: "tests/repository-scoping-isolation.test.ts" },
  { name: "Production System E2E Smoke Test", file: "tests/smoke.test.ts", timeoutMs: 90_000 },
];

const tsxCliPath = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const masterLogPath = path.resolve(process.cwd(), "test-results.log");

function runSuite(suite: TestSuite): Promise<{ success: boolean; durationMs: number; error?: string; logs: string }> {
  return new Promise((resolve) => {
    const timeoutMs = suite.timeoutMs ?? SUITE_TIMEOUT_MS;
    const suiteStart = Date.now();
    let timedOut = false;
    let settled = false;
    let logs = "";

    const child = spawn(process.execPath, [tsxCliPath, suite.file], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "test", ENABLE_LLM_IN_TESTS: "false" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      logs += text;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(text);
      logs += text;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const onFinish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const durationMs = Date.now() - suiteStart;
      if (timedOut) {
        resolve({
          success: false,
          durationMs,
          error: `Execution timed out after ${timeoutMs / 1000}s`,
          logs,
        });
      } else if (code === 0) {
        resolve({ success: true, durationMs, logs });
      } else {
        const failLines = logs
          .split("\n")
          .filter((l) => l.includes("FAIL") || l.includes("Error") || l.includes("assert") || l.includes("✗"))
          .slice(-5)
          .map((l) => l.trim())
          .join("; ");
        resolve({
          success: false,
          durationMs,
          error: failLines || `Process exited with code ${code ?? signal}`,
          logs,
        });
      }
    };

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ success: false, durationMs: Date.now() - suiteStart, error: err.message, logs });
    });

    child.on("exit", (code, signal) => onFinish(code, signal));
    child.on("close", (code, signal) => onFinish(code, signal));
  });
}

async function runAll() {
  console.log(
    "════════════════════════════════════════════════════════════════\n" +
      "PRODUCTION GIT DEBUGGING AGENT — FULL TEST SUITE RUNNER\n" +
      "════════════════════════════════════════════════════════════════\n",
  );

  await fs
    .writeFile(
      masterLogPath,
      `=== GIT DEBUGGING AGENT TEST SUITE RUNNER ===\nStarted: ${new Date().toISOString()}\n\n`,
      "utf8",
    )
    .catch(() => {});

  const startTime = Date.now();
  let passedSuites = 0;
  let failedSuites = 0;

  const results: Array<{
    name: string;
    file: string;
    success: boolean;
    durationMs: number;
    error?: string | undefined;
  }> = [];

  for (const suite of SUITES) {
    const timeout = (suite.timeoutMs ?? SUITE_TIMEOUT_MS) / 1000;
    console.log(`\n▶ Running Suite: ${suite.name} [${suite.file}] (timeout: ${timeout}s)...`);
    const res = await runSuite(suite);
    results.push({
      name: suite.name,
      file: suite.file,
      success: res.success,
      durationMs: res.durationMs,
      error: res.error,
    });

    await fs
      .appendFile(
        masterLogPath,
        `\n------------------------------------------------------------\nSUITE: ${suite.name} [${suite.file}]\nDURATION: ${res.durationMs}ms\nRESULT: ${res.success ? "PASS" : "FAIL"}\nERROR: ${res.error || "none"}\n------------------------------------------------------------\n${res.logs}\n`,
        "utf8",
      )
      .catch(() => {});

    if (res.success) {
      console.log(`✓ Suite "${suite.name}" PASSED in ${res.durationMs}ms`);
      passedSuites++;
    } else {
      console.error(`❌ Suite "${suite.name}" FAILED in ${res.durationMs}ms: ${res.error}`);
      failedSuites++;
      const escapedError = (res.error || "Unknown failure").replace(/\r?\n/g, " ");
      console.log(
        `::error file=${suite.file},title=Test Failure: ${suite.name}::Suite "${suite.name}" failed: ${escapedError}`,
      );
    }
  }

  const totalTimeMs = Date.now() - startTime;
  console.log(
    "\n════════════════════════════════════════════════════════════════\n" +
      "SUMMARY OF TEST EXECUTION\n" +
      "════════════════════════════════════════════════════════════════",
  );
  console.log(
    `Total Suites:   ${SUITES.length}\nPassed Suites:  ${passedSuites}\nFailed Suites:  ${failedSuites}\nTotal Duration: ${(totalTimeMs / 1000).toFixed(2)}s\n`,
  );

  const markdown = `## 🧪 Test Suite Execution Summary
| Test Suite | File | Status | Duration | Details |
| :--- | :--- | :---: | :---: | :--- |
${results.map((r) => `| **${r.name}** | \`${r.file}\` | ${r.success ? "✅ **Passed**" : "❌ **Failed**"} | ${(r.durationMs / 1000).toFixed(2)}s | ${r.error ? `\`${r.error.slice(0, 150)}\`` : "Passed cleanly"} |`).join("\n")}

**Result**: ${failedSuites === 0 ? "🎉 **All 10 test suites passed cleanly!**" : `⚠️ **${failedSuites} suite(s) failed**`} *(Total Duration: ${(totalTimeMs / 1000).toFixed(2)}s)*
`;

  await fs.writeFile("test-summary.md", markdown, "utf8").catch(() => {});

  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) {
    try {
      await fs.appendFile(summaryPath, markdown, "utf8");
    } catch {}
  }

  if (failedSuites > 0) {
    console.error("CI TEST SUITE FAILED");
    process.exit(1);
  } else {
    console.log("ALL TEST SUITES PASSED CLEANLY!");
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error("Master test runner error:", err);
  process.exit(1);
});
