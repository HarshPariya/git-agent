import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// Each suite gets 120 seconds. This prevents a hanging process (e.g. an
// unclosed MongoDB connection keeping the event loop alive) from blocking the
// entire CI run for 10+ minutes.
const SUITE_TIMEOUT_MS = 120_000;

interface TestSuite {
  name: string;
  command: string;
  /** Optional per-suite override when 120 s is not enough. */
  timeoutMs?: number;
}

const SUITES: TestSuite[] = [
  { name: "Git Engine & Safety Controls", command: "npx tsx tests/git-engine.test.ts" },
  { name: "Agent Orchestration & State Machine", command: "npx tsx tests/agent-orchestrator.test.ts" },
  { name: "Express API & Service Endpoints", command: "npx tsx tests/api.test.ts" },
  { name: "Guardrails, Security & Limits", command: "npx tsx tests/guardrails.test.ts" },
  { name: "Git Desktop & Commit Plan Engine", command: "npx tsx tests/git-desktop.test.ts" },
  { name: "E2E Git Desktop Workflow & Synchronization", command: "npx tsx tests/e2e-git-desktop-workflow.test.ts" },
  { name: "Multi-Tenant Isolation & Restart Recovery", command: "npx tsx tests/tenant-and-recovery.test.ts" },
  { name: "n8n Automation & Internal Endpoints", command: "npx tsx tests/n8n-automation.test.ts" },
  { name: "Production System E2E Smoke Test", command: "npx tsx tests/smoke.test.ts" },
];

async function runAll() {
  console.log(
    "════════════════════════════════════════════════════════════════\n" +
      "PRODUCTION GIT DEBUGGING AGENT — FULL TEST SUITE RUNNER\n" +
      "════════════════════════════════════════════════════════════════\n",
  );

  const startTime = Date.now();
  let passedSuites = 0;
  let failedSuites = 0;

  for (const suite of SUITES) {
    const timeout = suite.timeoutMs ?? SUITE_TIMEOUT_MS;
    console.log(`▶ Running Suite: ${suite.name} (timeout: ${timeout / 1000}s)...`);
    const suiteStart = Date.now();
    try {
      const { stdout, stderr } = await execAsync(suite.command, {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "test" },
        timeout,
        killSignal: "SIGKILL",
      });
      const durationMs = Date.now() - suiteStart;
      console.log(stdout.trim());
      if (stderr?.trim()) console.warn(stderr.trim());
      console.log(`✓ Suite "${suite.name}" PASSED in ${durationMs}ms\n`);
      passedSuites++;
    } catch (err: any) {
      const durationMs = Date.now() - suiteStart;
      const timedOut =
        err.killed === true || err.signal === "SIGKILL" || err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
      console.error(`❌ Suite "${suite.name}" ${timedOut ? "TIMED OUT" : "FAILED"} in ${durationMs}ms`);
      if (err.stdout) console.log(err.stdout);
      if (err.stderr) console.error(err.stderr);
      failedSuites++;
    }
  }

  const totalTimeMs = Date.now() - startTime;
  console.log(
    "════════════════════════════════════════════════════════════════\n" +
      "SUMMARY OF TEST EXECUTION\n" +
      "════════════════════════════════════════════════════════════════",
  );
  console.log(
    `Total Suites:   ${SUITES.length}\nPassed Suites:  ${passedSuites}\nFailed Suites:  ${failedSuites}\nTotal Duration: ${(totalTimeMs / 1000).toFixed(2)}s\n`,
  );

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
