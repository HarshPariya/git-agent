import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AgentStateMachine, type StateTransitionEvent } from "../src/agent/state-machine.js";
import { CriticAgent } from "../src/agent/critic.js";
import { applyPatch, revertPatch } from "../src/agent/patch-engine.js";
import { TaskPlanner } from "../src/agent/planner.js";
import type { FixPlan } from "../src/agent/fix-planner.js";
import type { DebugContext } from "../src/agent/context-builder.js";

async function runAgentOrchestratorTests() {
  console.log(
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAGENT ORCHESTRATION & REASONING TEST SUITE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
  );

  let passed = 0,
    failed = 0;
  const assert = (condition: boolean, name: string) => {
    console.log(condition ? `✓ [PASS] ${name}` : `❌ [FAIL] ${name}`);
    condition ? passed++ : failed++;
  };

  // 1. Agent State Machine
  const sm = new AgentStateMachine("test-session-1");
  assert(sm.getState() === "IDLE", "Initial state is IDLE");
  const events: StateTransitionEvent[] = [];
  const unsubscribe = sm.subscribe((ev) => events.push(ev));
  sm.transition("INITIALIZING", "Session started");
  sm.transition("SCANNING_REPOSITORY", "Scan files");
  sm.transition("INDEXING_GRAPHRAG", "Build code graph");
  sm.transition("GENERATING_HYPOTHESES", "Hypothesis cycle");
  sm.transition("COMPLETED", "Task resolved");
  assert(sm.getState() === "COMPLETED", "Final state is COMPLETED");
  assert(sm.isTerminal() === true, "isTerminal returns true for COMPLETED");
  assert(events.length === 5, "Listener received all 5 transition events");
  assert(sm.getHistory().length === 5, "State history recorded 5 transitions");
  unsubscribe();
  sm.transition("IDLE");
  assert(events.length === 5, "Unsubscribed listener no longer invoked");

  // 2. Critic Agent Verification & Guardrails
  const critic = new CriticAgent();
  const sampleContext: DebugContext = {
    repositoryId: "ai-chatbot",
    repositoryName: "ai-chatbot",
    localPath: process.cwd(),
    query: "Fix null pointer in user authentication token parsing",
    git: {
      branch: "main",
      ahead: 0,
      behind: 0,
      clean: true,
      recentCommits: "",
      changedFiles: [],
      diff: "",
      branches: ["main"],
    },
    code: {
      symbols: ["decodeToken"],
      graphNodes: 10,
      graphEdges: 15,
      relevantFiles: ["src/security/auth.ts"],
      searchResults: "",
    },
    stackTrace: "TypeError: Cannot read properties of undefined (reading 'userId')",
    issueText: undefined,
    prText: undefined,
    builtAt: new Date().toISOString(),
  };

  const safePlan: FixPlan = {
    id: "plan-safe",
    problem: "Null pointer in token",
    rootCause: "Null check missing on decoded JWT payload",
    riskLevel: "LOW",
    requiresApproval: false,
    autoApprovePolicy: true,
    estimatedImpact: "Minimal",
    filesToChange: [
      {
        filePath: "src/security/auth.ts",
        description: "Add null check on token payload",
        patch: "+ if (!payload) throw new AppError('Unauthorized', 401);",
        linesAffected: 1,
      },
    ],
    testsToRun: ["npm test"],
    rollbackStrategy: "git checkout src/security/auth.ts",
    createdAt: new Date().toISOString(),
    evidence: ["auth.ts line 42 accesses payload.userId directly"],
  };
  const safeReview = await critic.review(safePlan, sampleContext, true);
  assert(safeReview.verdict !== "REJECTED", "Safe fix plan not rejected by Critic");
  assert(safeReview.score >= 70, "Safe plan receives high review score");
  assert(safeReview.fixesRootCause === true, "Critic verifies root cause coverage");

  const dangerousPlan: FixPlan = {
    id: "plan-danger",
    problem: "System reset",
    rootCause: "Database corrupted",
    riskLevel: "CRITICAL",
    requiresApproval: true,
    autoApprovePolicy: false,
    estimatedImpact: "Dangerous deletion",
    filesToChange: [
      {
        filePath: "scripts/deploy.sh",
        description: "Execute rm -rf / to wipe files",
        patch: "- rm -rf /",
        linesAffected: 5,
      },
    ],
    testsToRun: [],
    rollbackStrategy: "None",
    createdAt: new Date().toISOString(),
    evidence: [],
  };
  const dangerReview = await critic.review(dangerousPlan, sampleContext, false);
  assert(dangerReview.verdict === "REJECTED", "Critic flags dangerous fix plan as REJECTED");

  // 3. Task Planner
  const planner = new TaskPlanner();
  const planResult = await planner.classify("Fix merge conflict in src/agent/planner.ts and add test suite");
  assert(planResult.steps.length > 0, "TaskPlanner decomposed query into actionable steps");
  assert(planResult.taskClass === "MERGE_CONFLICT", "TaskPlanner classified as MERGE_CONFLICT");
  const classification = await planner.classify("Git merge conflict between development and feature branch");
  assert(classification.taskClass === "MERGE_CONFLICT", "TaskPlanner classified conflict resolution task accurately");

  // 4. Patch Engine: Apply & Rollback
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "patch-engine-test-"));
  try {
    const testFilePath = "src/dummy.ts";
    const absoluteFilePath = path.join(tempDir, testFilePath);
    await fs.mkdir(path.dirname(absoluteFilePath), { recursive: true });
    await fs.writeFile(absoluteFilePath, "export const value = 1;\n", "utf-8");

    const patchResult = await applyPatch(
      tempDir,
      [
        {
          filePath: testFilePath,
          originalContent: "export const value = 1;\n",
          newContent: "export const value = 2;\n",
          explanation: "Increment value",
        },
      ],
      "Test Patch",
    );
    assert(patchResult.success === true, "applyPatch executed successfully");
    assert(Boolean(patchResult.backupId), "applyPatch generated backupId");
    const patchedContent = await fs.readFile(absoluteFilePath, "utf-8");
    assert(patchedContent === "export const value = 2;\n", "Target file received patched content");

    if (patchResult.backupId) {
      const revertResult = await revertPatch(patchResult.backupId);
      assert(revertResult.success === true, "revertPatch executed successfully");
      const revertedContent = await fs.readFile(absoluteFilePath, "utf-8");
      assert(revertedContent === "export const value = 1;\n", "Target file restored to original content");
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(
    `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nAGENT ORCHESTRATION TEST RESULTS: ${passed} Passed, ${failed} Failed.\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

runAgentOrchestratorTests()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    console.error("Agent Orchestrator test failed:", err);
    process.exit(1);
  });
