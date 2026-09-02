import test from "node:test";
import assert from "node:assert/strict";

import { UserMemoryStore } from "../src/agent/user-memory.js";
import { extractUserInsights } from "../src/agent/insight-extractor.js";

test("UserMemoryStore manages user preferences and facts cleanly", async () => {
  const store = new UserMemoryStore();
  const tenantId = "test-tenant-mem";
  const userId = "user-alice";

  // Initially empty
  assert.equal(store.getInsights(tenantId, userId).length, 0);
  assert.equal(store.formatInsightsForPrompt(tenantId, userId), "");

  // Add preference
  await store.addInsight(tenantId, userId, {
    category: "preference",
    topic: "programming_language",
    insight: "Prefers TypeScript for code generation.",
  });

  const insights = store.getInsights(tenantId, userId);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]?.category, "preference");
  assert.equal(insights[0]?.topic, "programming_language");

  const formatted = store.formatInsightsForPrompt(tenantId, userId);
  assert.ok(formatted.includes("Prefers TypeScript for code generation."));
});

test("UserMemoryStore topic deduplication and updates", async () => {
  const store = new UserMemoryStore();
  const tenantId = "test-tenant-dedup";
  const userId = "user-bob";

  await store.addInsight(tenantId, userId, {
    category: "preference",
    topic: "response_style",
    insight: "Wants responses to be short.",
  });

  await store.addInsight(tenantId, userId, {
    category: "preference",
    topic: "response_style",
    insight: "Wants responses to be concise and structured.",
  });

  const list = store.getInsights(tenantId, userId);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.insight, "Wants responses to be concise and structured.");
});

test("extractUserInsights extracts language, style, and tech stack facts", async () => {
  const store = new UserMemoryStore();
  const tenantId = "test-tenant-extract";
  const userId = "user-charlie";

  const msg1 = "Please remember that our project uses PostgreSQL and Express.";
  const count1 = await extractUserInsights(tenantId, userId, msg1, store);
  assert.ok(count1 > 0);

  const msg2 = "Always use TypeScript and prefer async/await.";
  const count2 = await extractUserInsights(tenantId, userId, msg2, store);
  assert.ok(count2 >= 2);

  const insights = store.getInsights(tenantId, userId);
  assert.ok(insights.length >= 3);

  const formatted = store.formatInsightsForPrompt(tenantId, userId);
  assert.ok(formatted.includes("TypeScript"));
  assert.ok(formatted.includes("async/await"));
});

test("Tenant and User Memory Isolation", async () => {
  const store = new UserMemoryStore();

  await store.addInsight("tenant-1", "user-1", {
    category: "fact",
    topic: "db",
    insight: "Uses MongoDB",
  });

  await store.addInsight("tenant-2", "user-2", {
    category: "fact",
    topic: "db",
    insight: "Uses PostgreSQL",
  });

  assert.equal(store.getInsights("tenant-1", "user-1")[0]?.insight, "Uses MongoDB");
  assert.equal(store.getInsights("tenant-2", "user-2")[0]?.insight, "Uses PostgreSQL");
  assert.equal(store.getInsights("tenant-1", "user-2").length, 0);
});
