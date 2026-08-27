import test from "node:test";
import assert from "node:assert/strict";

import { app } from "../src/app.js";

const makeRequest = async (
  path: string,
  init?: RequestInit,
): Promise<Response> => {
  const server = app.listen(0);

  try {
    const address = server.address();

    if (!address || typeof address === "string") {
      throw new Error("Test server address is unavailable");
    }

    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    server.close();
  }
};

test("health endpoint remains public", async () => {
  const response = await makeRequest("/health");

  assert.equal(response.status, 200);

  const body = (await response.json()) as {
    status: string;
  };

  assert.equal(body.status, "ok");
});

test("chat rejects missing identity", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "http-test",
      message: "What is GraphRAG?",
    }),
  });

  assert.equal(response.status, 401);
});

test("chat rejects unauthorized role", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-http-test",
      "x-user-id": "user-http-test",
      "x-user-role": "guest",
    },
    body: JSON.stringify({
      sessionId: "http-test",
      message: "What is GraphRAG?",
    }),
  });

  assert.equal(response.status, 403);
});

test("chat accepts authorized identity", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "tenant-http-valid",
      "x-user-id": "user-http-valid",
      "x-user-role": "user",
    },
    body: JSON.stringify({
      sessionId: "http-test",
      message: "What is GraphRAG?",
    }),
  });

  assert.notEqual(response.status, 401);
  assert.notEqual(response.status, 403);
});
