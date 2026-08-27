import test from "node:test";
import assert from "node:assert/strict";

import { authorize } from "../src/security/authorization.js";
import { InMemoryRateLimiter } from "../src/security/rate-limit.js";
import { createTenantContext } from "../src/security/tenant-context.js";

test("creates a normalized tenant context", () => {
  const context = createTenantContext(" tenant-1 ", " user-1 ");

  assert.deepEqual(context, {
    tenantId: "tenant-1",
    userId: "user-1",
  });
});

test("rejects an invalid tenant context", () => {
  assert.throws(
    () => createTenantContext("", "user-1"),
    /Invalid tenant context/,
  );
});

test("authorizes user chat access", () => {
  const context = createTenantContext("tenant-1", "user-1");

  assert.equal(
    authorize({
      context,
      role: "user",
      permission: "chat:write",
    }),
    true,
  );
});

test("blocks user document administration", () => {
  const context = createTenantContext("tenant-1", "user-1");

  assert.equal(
    authorize({
      context,
      role: "user",
      permission: "documents:write",
    }),
    false,
  );
});

test("allows admin document access", () => {
  const context = createTenantContext("tenant-1", "admin-1");

  assert.equal(
    authorize({
      context,
      role: "admin",
      permission: "documents:write",
    }),
    true,
  );
});

test("enforces request limits", () => {
  const limiter = new InMemoryRateLimiter(2, 1_000);

  const first = limiter.check("tenant-1", 1_000);
  const second = limiter.check("tenant-1", 1_001);
  const third = limiter.check("tenant-1", 1_002);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
});

test("resets limits after the window", () => {
  const limiter = new InMemoryRateLimiter(1, 1_000);

  limiter.check("tenant-1", 1_000);
  const result = limiter.check("tenant-1", 2_000);

  assert.equal(result.allowed, true);
});
