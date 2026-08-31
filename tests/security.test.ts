import test from "node:test";
import assert from "node:assert/strict";

import { authorize, type Permission } from "../src/security/authorization.js";
import { InMemoryRateLimiter } from "../src/security/rate-limit.js";
import { createTenantContext } from "../src/security/tenant-context.js";
import { securityMiddleware } from "../src/middleware/security.js";

test("security: creates valid tenant context", () => {
  const context = createTenantContext("  tenant-abc  ", "  user-xyz  ");
  assert.equal(context.tenantId, "tenant-abc");
  assert.equal(context.userId, "user-xyz");
  assert.ok(Object.isFrozen(context));
});

test("security: rejects invalid tenant contexts", () => {
  assert.throws(() => createTenantContext("", "user-1"), /Invalid tenant context/);
  assert.throws(() => createTenantContext("tenant-1", ""), /Invalid tenant context/);
  assert.throws(() => createTenantContext("   ", "user-1"), /Invalid tenant context/);
  assert.throws(() => createTenantContext("tenant-1", "   "), /Invalid tenant context/);
});

test("security: authorization enforcement for all roles", () => {
  const userContext = createTenantContext("tenant-1", "user-1");
  const adminContext = createTenantContext("tenant-1", "admin-1");

  const chatPermissions: Permission[] = ["chat:read", "chat:write"];
  const docPermissions: Permission[] = ["documents:read", "documents:write"];

  // User role permissions
  for (const perm of chatPermissions) {
    assert.equal(
      authorize({ context: userContext, role: "user", permission: perm }),
      true,
      `User should have ${perm}`,
    );
  }
  for (const perm of docPermissions) {
    assert.equal(
      authorize({ context: userContext, role: "user", permission: perm }),
      false,
      `User should NOT have ${perm}`,
    );
  }

  // Admin role permissions
  for (const perm of [...chatPermissions, ...docPermissions]) {
    assert.equal(
      authorize({ context: adminContext, role: "admin", permission: perm }),
      true,
      `Admin should have ${perm}`,
    );
  }

  // Unknown role
  assert.equal(
    authorize({ context: userContext, role: "anonymous", permission: "chat:read" }),
    false,
  );
  assert.equal(
    authorize({ context: userContext, role: "", permission: "chat:read" }),
    false,
  );
});

test("security: rate limiter isolates multiple tenants", () => {
  const limiter = new InMemoryRateLimiter(2, 5000);
  const now = Date.now();

  // Tenant A consumes limit
  assert.equal(limiter.check("tenant-A", now).allowed, true);
  assert.equal(limiter.check("tenant-A", now).allowed, true);
  assert.equal(limiter.check("tenant-A", now).allowed, false);

  // Tenant B is unaffected
  assert.equal(limiter.check("tenant-B", now).allowed, true);
  assert.equal(limiter.check("tenant-B", now).allowed, true);
  assert.equal(limiter.check("tenant-B", now).allowed, false);
});

test("security: rate limiter cleanup and reset", () => {
  const limiter = new InMemoryRateLimiter(5, 1000);
  const start = 10_000;

  limiter.check("tenant-1", start);
  limiter.check("tenant-2", start);

  const cleanedBeforeExpiry = limiter.cleanupExpired(start + 500);
  assert.equal(cleanedBeforeExpiry, 0);

  const cleanedAfterExpiry = limiter.cleanupExpired(start + 1500);
  assert.equal(cleanedAfterExpiry, 2);

  limiter.check("tenant-3", start + 2000);
  limiter.reset("tenant-3");
  assert.equal(limiter.check("tenant-3", start + 2000).remaining, 4);
});

test("security middleware: blocks cross-tenant or missing identity", () => {
  const req = {
    header: (name: string) => {
      switch (name.toLowerCase()) {
        case "x-tenant-id":
          return "tenant-1";
        case "x-user-id":
          return "";
        default:
          return undefined;
      }
    },
  };

  let statusCode = 0;
  let bodyPayload: unknown;
  const res = {
    status: (code: number) => {
      statusCode = code;
      return res;
    },
    json: (data: unknown) => {
      bodyPayload = data;
      return res;
    },
  };

  let nextCalled = false;
  securityMiddleware(req as never, res as never, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
  assert.deepEqual(bodyPayload, {
    error: {
      code: "AUTHENTICATION_ERROR",
      message: "Tenant and user identity are required.",
    },
  });
});
