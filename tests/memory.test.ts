import test from "node:test";
import assert from "node:assert/strict";

import { ConversationMemory } from "../src/agent/memory.js";

test("stores and retrieves conversation messages", () => {
  const memory = new ConversationMemory();

  memory.add("tenant-1", "session-1", {
    role: "user",
    content: "Hello",
  });

  memory.add("tenant-1", "session-1", {
    role: "assistant",
    content: "Hi",
  });

  assert.deepEqual(memory.get("tenant-1", "session-1"), [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi" },
  ]);
});

test("keeps conversation history bounded", () => {
  const memory = new ConversationMemory(2);

  memory.add("tenant-1", "session-1", {
    role: "user",
    content: "One",
  });

  memory.add("tenant-1", "session-1", {
    role: "assistant",
    content: "Two",
  });

  memory.add("tenant-1", "session-1", {
    role: "user",
    content: "Three",
  });

  assert.deepEqual(memory.get("tenant-1", "session-1"), [
    { role: "assistant", content: "Two" },
    { role: "user", content: "Three" },
  ]);
});

test("isolates sessions and tenants", () => {
  const memory = new ConversationMemory();

  memory.add("tenant-1", "session-1", {
    role: "user",
    content: "Tenant one",
  });

  memory.add("tenant-2", "session-1", {
    role: "user",
    content: "Tenant two",
  });

  memory.add("tenant-1", "session-2", {
    role: "user",
    content: "Session two",
  });

  assert.equal(memory.get("tenant-1", "session-1")[0]?.content, "Tenant one");

  assert.equal(memory.get("tenant-2", "session-1")[0]?.content, "Tenant two");

  assert.equal(memory.get("tenant-1", "session-2")[0]?.content, "Session two");
});
