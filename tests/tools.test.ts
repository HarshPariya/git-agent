import test from "node:test";
import assert from "node:assert/strict";

import type {
  RetrievalRequest,
  RetrievalResult,
} from "../src/retrieval/types.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createKnowledgeTool } from "../src/tools/retrieve-knowledge.js";

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
