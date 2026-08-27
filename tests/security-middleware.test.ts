import test from "node:test";
import assert from "node:assert/strict";

import { securityMiddleware } from "../src/middleware/security.js";

const createRequest = (headers: Record<string, string> = {}) => ({
  header(name: string): string | undefined {
    return headers[name.toLowerCase()];
  },
});

const createResponse = () => {
  const result: {
    statusCode: number;
    body: unknown;
  } = {
    statusCode: 200,
    body: undefined,
  };

  return {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
    result,
  };
};

test("allows an authorized chat request", () => {
  const request = createRequest({
    "x-tenant-id": "tenant-1",
    "x-user-id": "user-1",
    "x-user-role": "user",
  });

  const response = createResponse();

  let nextCalled = false;

  securityMiddleware(request as never, response as never, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(response.result.statusCode, 200);
  assert.deepEqual(
    (
      request as never as {
        tenantContext?: {
          tenantId: string;
          userId: string;
        };
      }
    ).tenantContext,
    {
      tenantId: "tenant-1",
      userId: "user-1",
    },
  );
});

test("rejects a request without identity", () => {
  const request = createRequest();
  const response = createResponse();

  let nextCalled = false;

  securityMiddleware(request as never, response as never, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.result.statusCode, 401);
});

test("rejects an unauthorized role", () => {
  const request = createRequest({
    "x-tenant-id": "tenant-1",
    "x-user-id": "user-1",
    "x-user-role": "guest",
  });

  const response = createResponse();

  let nextCalled = false;

  securityMiddleware(request as never, response as never, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(response.result.statusCode, 403);
});

test("rate limits repeated requests", () => {
  const request = createRequest({
    "x-tenant-id": "rate-limit-test",
    "x-user-id": "user-1",
    "x-user-role": "user",
  });

  let allowed = 0;
  let rejected = 0;

  for (let index = 0; index < 35; index += 1) {
    const response = createResponse();

    securityMiddleware(request as never, response as never, () => {
      allowed += 1;
    });

    if (response.result.statusCode === 429) {
      rejected += 1;
    }
  }

  assert.equal(allowed, 30);
  assert.equal(rejected, 5);
});
