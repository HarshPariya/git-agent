import test from "node:test";
import assert from "node:assert/strict";

import type {
  RetrievalRequest,
  RetrievalResult,
} from "../src/retrieval/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createKnowledgeTool } from "../src/tools/retrieve-knowledge.js";
import { createListDirectoryTool } from "../src/tools/list-directory.js";
import { createReadFileTool } from "../src/tools/read-file.js";
import { createGitStatusTool } from "../src/tools/git-status.js";
import { createWriteFileTool } from "../src/tools/write-file.js";
import { createEditFileTool } from "../src/tools/edit-file.js";
import { createDeleteFileTool } from "../src/tools/delete-file.js";

test("registers and resolves a knowledge tool", async () => {
  const registry = new ToolRegistry();

  const tool = createKnowledgeTool(async () => [
    {
      content: "Refunds are available within 30 days.",
      source: "refund-policy.pdf",
      page: 4,
      score: 0.98,
    },
  ]);

  registry.register(tool);

  const resolved = registry.get<RetrievalRequest, readonly RetrievalResult[]>(
    "retrieve_knowledge",
  );

  const result = await resolved.execute({
    input: {
      query: "What is the refund policy?",
    },
    permissions: ["read"],
  });

  assert.equal(result[0]?.source, "refund-policy.pdf");
});

test("list_directory tool lists files in src/agent safely", async () => {
  const tool = createListDirectoryTool();
  const result = await tool.execute({
    input: { path: "src/agent" },
    permissions: ["read"],
  });

  assert.ok(result.totalEntries > 0);
  assert.ok(result.entries.some((e) => e.name === "orchestrator.ts"));
});

test("list_directory tool blocks path traversal attack", async () => {
  const tool = createListDirectoryTool();
  await assert.rejects(
    () =>
      tool.execute({
        input: { path: "../../windows/system32" },
        permissions: ["read"],
      }),
    /Access denied: path escapes workspace root/,
  );
});

test("read_file tool reads package.json contents", async () => {
  const tool = createReadFileTool();
  const result = await tool.execute({
    input: { path: "package.json", startLine: 1, endLine: 5 },
    permissions: ["read"],
  });

  assert.equal(result.path, "package.json");
  assert.ok(result.content.includes("ai-chatbot"));
});

test("read_file tool blocks sensitive .env file reading", async () => {
  const tool = createReadFileTool();
  await assert.rejects(
    () =>
      tool.execute({
        input: { path: ".env" },
        permissions: ["read"],
      }),
    /Access denied: reading sensitive file is prohibited/,
  );
});

test("git_status tool returns repository status", async () => {
  const tool = createGitStatusTool();
  const result = await tool.execute({
    input: { action: "status" },
    permissions: ["read"],
  });

  assert.equal(result.action, "status");
  assert.ok(typeof result.output === "string");
});

test("write_file, edit_file, and delete_file tools lifecycle", async () => {
  const writeTool = createWriteFileTool();
  const editTool = createEditFileTool();
  const deleteTool = createDeleteFileTool();
  const testPath = "src/tools/temp-test-file.txt";

  const writeResult = await writeTool.execute({
    input: { path: testPath, content: "Hello World Initial Content" },
    permissions: ["write"],
  });
  assert.ok(writeResult.bytesWritten > 0);

  const editResult = await editTool.execute({
    input: {
      path: testPath,
      targetContent: "Initial Content",
      replacementContent: "Updated Content",
    },
    permissions: ["write"],
  });
  assert.equal(editResult.modified, true);

  const deleteResult = await deleteTool.execute({
    input: { path: testPath },
    permissions: ["write"],
  });
  assert.equal(deleteResult.deleted, true);
});

test("delete_file blocks deleting protected files", async () => {
  const deleteTool = createDeleteFileTool();
  await assert.rejects(
    () =>
      deleteTool.execute({
        input: { path: "package.json" },
        permissions: ["write"],
      }),
    /Access denied: deleting protected project file is prohibited/,
  );
});

test("rejects duplicate tool registration", () => {
  const registry = new ToolRegistry();
  const tool = createKnowledgeTool(async () => []);

  registry.register(tool);
  assert.throws(() => registry.register(tool), /Tool already registered/);
});

test("rejects unknown tools", () => {
  const registry = new ToolRegistry();
  assert.throws(() => registry.get("unknown_tool"), /Unknown tool/);
});
