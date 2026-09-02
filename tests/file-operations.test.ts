import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import type { Retriever, RetrievalResult } from "../src/retrieval/types.js";
import type { LlmProvider } from "../src/types/llm.js";

const mockRetriever: Retriever = {
  search: async (): Promise<readonly RetrievalResult[]> => [],
};

const mockLlm: LlmProvider = {
  generate: async ({ input }) => ({
    id: "mock-llm-id",
    model: "mock-llm",
    text: `Generated response for: ${input}`,
  }),
};

describe("Comprehensive File Operations across Any File Extension", () => {
  const memory = new ConversationMemory();
  const agent = createAgent(memory, mockRetriever, mockLlm);
  const tenantId = "test-tenant-files";
  const sessionId = "test-session-files";

  it("1. Creates harsh.py with exact content 'heyy harsh' from natural phrasing", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "now make a new file harsh.py and inside write code heyy harsh",
      retrievalMode: "code",
    });

    assert.ok(res.text.includes("write_file") || res.text.includes("✅"));
    assert.ok(res.text.includes("heyy harsh"));
    assert.ok(res.toolActivity.length > 0);
    assert.equal(res.toolActivity[0]?.toolName, "write_file");
    assert.equal(res.toolActivity[0]?.success, true);

    // Verify on disk
    const content = await fs.readFile(path.join(process.cwd(), "harsh.py"), "utf-8");
    assert.equal(content.trim(), "heyy harsh");
  });

  it("2. Reads harsh.py", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "read file harsh.py",
      retrievalMode: "code",
    });

    assert.ok(res.text.includes("heyy harsh"));
    assert.ok(res.toolActivity.some((a) => a.toolName === "read_file" && a.success));
  });

  it("3. Edits harsh.py to change 'heyy' to 'hello'", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "edit file harsh.py and change heyy to hello",
      retrievalMode: "code",
    });

    assert.ok(res.text.includes("edit_file") || res.text.includes("✅"));
    assert.ok(res.toolActivity.some((a) => a.toolName === "edit_file" && a.success));

    // Verify on disk
    const content = await fs.readFile(path.join(process.cwd(), "harsh.py"), "utf-8");
    assert.equal(content.trim(), "hello harsh");
  });

  it("4. Deletes harsh.py and verifies removal", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "delete file harsh.py",
      retrievalMode: "code",
    });

    assert.ok(res.text.includes("delete_file") || res.text.includes("✅"));
    assert.ok(res.toolActivity.some((a) => a.toolName === "delete_file" && a.success));

    // Verify removal
    let exists = true;
    try {
      await fs.access(path.join(process.cwd(), "harsh.py"));
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  });

  it("5. Creates and manipulates .html file (index.html)", async () => {
    const writeRes = await agent.run({
      tenantId,
      sessionId,
      question: "create a new file scratch/demo.html with content <h1>Welcome to GraphRAG</h1>",
      retrievalMode: "code",
    });
    assert.ok(writeRes.text.includes("write_file") || writeRes.text.includes("✅"));

    const editRes = await agent.run({
      tenantId,
      sessionId,
      question: "modify scratch/demo.html to replace Welcome with Hello",
      retrievalMode: "code",
    });
    assert.ok(editRes.text.includes("edit_file") || editRes.text.includes("✅"));

    const readRes = await agent.run({
      tenantId,
      sessionId,
      question: "show contents of file scratch/demo.html",
      retrievalMode: "code",
    });
    assert.ok(readRes.text.includes("<h1>Hello to GraphRAG</h1>"));

    const deleteRes = await agent.run({
      tenantId,
      sessionId,
      question: "delete file scratch/demo.html",
      retrievalMode: "code",
    });
    assert.ok(deleteRes.text.includes("delete_file") || deleteRes.text.includes("✅"));
  });

  it("6. Creates and manipulates PyTorch model weight file (.pt)", async () => {
    const writeRes = await agent.run({
      tenantId,
      sessionId,
      question: "make a new file scratch/model.pt and inside write code weights: [0.12, 0.45, 0.88]",
      retrievalMode: "code",
    });
    assert.ok(writeRes.text.includes("write_file") || writeRes.text.includes("✅"));

    const readRes = await agent.run({
      tenantId,
      sessionId,
      question: "read scratch/model.pt",
      retrievalMode: "code",
    });
    assert.ok(readRes.text.includes("weights: [0.12, 0.45, 0.88]"));

    const deleteRes = await agent.run({
      tenantId,
      sessionId,
      question: "remove scratch/model.pt",
      retrievalMode: "code",
    });
    assert.ok(deleteRes.text.includes("delete_file") || deleteRes.text.includes("✅"));
  });

  it("7. Creates and manipulates TypeScript file (.ts)", async () => {
    const writeRes = await agent.run({
      tenantId,
      sessionId,
      question: "create file scratch/sample.ts containing export const version = '1.0.0';",
      retrievalMode: "code",
    });
    assert.ok(writeRes.text.includes("write_file") || writeRes.text.includes("✅"));

    const editRes = await agent.run({
      tenantId,
      sessionId,
      question: "change 1.0.0 to 2.0.0 in scratch/sample.ts",
      retrievalMode: "code",
    });
    assert.ok(editRes.text.includes("edit_file") || editRes.text.includes("✅"));

    const readRes = await agent.run({
      tenantId,
      sessionId,
      question: "view scratch/sample.ts",
      retrievalMode: "code",
    });
    assert.ok(readRes.text.includes("export const version = '2.0.0';"));

    const deleteRes = await agent.run({
      tenantId,
      sessionId,
      question: "delete file scratch/sample.ts",
      retrievalMode: "code",
    });
    assert.ok(deleteRes.text.includes("delete_file") || deleteRes.text.includes("✅"));
  });

  it("8. Reads exact first 15 lines of planner.ts", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "now read planner.ts and give me first 15 lines",
      retrievalMode: "code",
    });

    assert.ok(res.toolActivity.some((a) => a.toolName === "read_file" && a.success));
    // Verify it contains line 1 import and line 15 Tier 2 comment, but NOT line 30+
    assert.ok(res.text.includes("import type { AgentAction, AgentPlan, PlanRequest }"));
    assert.ok(!res.text.includes("REFUSE_PATTERNS"));
    const codeBlockMatch = /```(?:typescript|ts)?\n([\s\S]*?)\n```/.exec(res.text);
    assert.ok(codeBlockMatch?.[1]);
    const lines = codeBlockMatch[1].split("\n");
    assert.equal(lines.length, 15);
  });

  it("9. Reads specific line range (lines 10 to 20)", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "read lines 10 to 20 of src/agent/planner.ts",
      retrievalMode: "code",
    });

    assert.ok(res.toolActivity.some((a) => a.toolName === "read_file" && a.success));
    const codeBlockMatch = /```(?:typescript|ts)?\n([\s\S]*?)\n```/.exec(res.text);
    assert.ok(codeBlockMatch?.[1]);
    const lines = codeBlockMatch[1].split("\n");
    assert.equal(lines.length, 11);
  });

  it("10. Reads last 5 lines of a file", async () => {
    const res = await agent.run({
      tenantId,
      sessionId,
      question: "show last 5 lines of package.json",
      retrievalMode: "code",
    });

    assert.ok(res.toolActivity.some((a) => a.toolName === "read_file" && a.success));
    const codeBlockMatch = /```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/.exec(res.text);
    assert.ok(codeBlockMatch?.[1]);
    const lines = codeBlockMatch[1].trim().split(/\r?\n/);
    assert.equal(lines.length, 5);
  });
});
