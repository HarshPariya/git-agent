import test from "node:test";
import assert from "node:assert/strict";

import { ToolRegistry } from "../src/tools/registry.js";
import { createKnowledgeTool } from "../src/tools/retrieve-knowledge.js";

test("exposes a runtime knowledge tool", async () => {
  const registry = new ToolRegistry();

  registry.register(
    createKnowledgeTool(async ({ query }) => [
      {
        content: `Matched: ${query}`,
        source: "demo.pdf",
        page: 1,
        score: 1,
      },
    ]),
  );

  const tool = registry.getRuntime("retrieve_knowledge", {
    tenantId: "test",
    sessionId: "test",
    userPermissions: ["read"],
  });
  const result = await tool.execute({
    query: "refund policy",
  });

  assert.deepEqual(result, [
    {
      content: "Matched: refund policy",
      source: "demo.pdf",
      page: 1,
      score: 1,
    },
  ]);
});

test("rejects invalid runtime tool input", async () => {
  const registry = new ToolRegistry();

  registry.register(createKnowledgeTool(async () => []));

  const tool = registry.getRuntime("retrieve_knowledge", {
    tenantId: "test",
    sessionId: "test",
    userPermissions: ["read"],
  });

  await assert.rejects(
    () => tool.execute({ query: "" }),
    /Knowledge query must not be empty/,
  );
});
