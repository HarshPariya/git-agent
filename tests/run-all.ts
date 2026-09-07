import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

interface TestSuite {
  name: string;
  command: string;
}

const SUITES: TestSuite[] = [
  { name: "Git Engine & Safety Controls", command: "npx tsx tests/git-engine.test.ts" },
  { name: "Agent Orchestration & State Machine", command: "npx tsx tests/agent-orchestrator.test.ts" },
  { name: "Express API & Service Endpoints", command: "npx tsx tests/api.test.ts" },
  { name: "Guardrails, Security & Limits", command: "npx tsx tests/guardrails.test.ts" },
  { name: "Git Desktop & Commit Plan Engine", command: "npx tsx tests/git-desktop.test.ts" },
];

async function runAll() {
  console.log("════════════════════════════════════════════════════════════════");
  console.log("🚀 PRODUCTION GIT DEBUGGING AGENT — FULL TEST SUITE RUNNER");
  console.log("════════════════════════════════════════════════════════════════\n");

  const startTime = Date.now();
  let totalSuites = SUITES.length;
  let passedSuites = 0;
  let failedSuites = 0;

  for (const suite of SUITES) {
    console.log(`▶ Running Suite: ${suite.name}...`);
    const suiteStart = Date.now();
    try {
      const { stdout, stderr } = await execAsync(suite.command, {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "test" },
      });
      const durationMs = Date.now() - suiteStart;
      console.log(stdout.trim());
      if (stderr && stderr.trim()) {
        console.warn(stderr.trim());
      }
      console.log(`✓ Suite "${suite.name}" PASSED in ${durationMs}ms\n`);
      passedSuites++;
    } catch (err: any) {
      const durationMs = Date.now() - suiteStart;
      console.error(`❌ Suite "${suite.name}" FAILED in ${durationMs}ms`);
      if (err.stdout) console.log(err.stdout);
      if (err.stderr) console.error(err.stderr);
      failedSuites++;
    }
  }

  const totalTimeMs = Date.now() - startTime;
  console.log("════════════════════════════════════════════════════════════════");
  console.log("📊 SUMMARY OF TEST EXECUTION");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Total Suites:   ${totalSuites}`);
  console.log(`Passed Suites:  ${passedSuites}`);
  console.log(`Failed Suites:  ${failedSuites}`);
  console.log(`Total Duration: ${(totalTimeMs / 1000).toFixed(2)}s\n`);

  if (failedSuites > 0) {
    console.error("❌ CI TEST SUITE FAILED");
    process.exit(1);
  } else {
    console.log("✅ ALL TEST SUITES PASSED CLEANLY!");
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error("Master test runner error:", err);
  process.exit(1);
});
