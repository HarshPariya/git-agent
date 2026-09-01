process.env.NODE_ENV = "test";

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

    return await fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init,
      headers: {
        connection: "close",
        ...init?.headers,
      },
    });
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
};

test("E2E: GET /health returns 200 and environment status", async () => {
  const response = await makeRequest("/health");
  assert.equal(response.status, 200);

  const data = (await response.json()) as { status: string; environment: string };
  assert.equal(data.status, "ok");
  assert.ok(data.environment);
});

test("E2E: POST /chat rejects unauthenticated request with 401", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId: "e2e-session-1",
      message: "Hello",
    }),
  });

  assert.equal(response.status, 401);
  const data = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(data.error.code, "AUTHENTICATION_ERROR");
});

test("E2E: POST /chat rejects unauthorized role with 403", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "e2e-tenant-1",
      "x-user-id": "e2e-user-1",
      "x-user-role": "unauthorized_role",
    },
    body: JSON.stringify({
      sessionId: "e2e-session-1",
      message: "Hello",
    }),
  });

  assert.equal(response.status, 403);
  const data = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(data.error.code, "AUTHORIZATION_ERROR");
});

test("E2E: POST /chat rejects empty message with 400 validation error", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "e2e-tenant-1",
      "x-user-id": "e2e-user-1",
      "x-user-role": "user",
    },
    body: JSON.stringify({
      sessionId: "e2e-session-1",
      message: "",
    }),
  });

  assert.equal(response.status, 400);
  const data = (await response.json()) as { error: { code: string; message: string } };
  assert.equal(data.error.code, "VALIDATION_ERROR");
});

test("E2E: POST /chat processes authorized request and returns response", async () => {
  const response = await makeRequest("/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-tenant-id": "e2e-tenant-auth",
      "x-user-id": "e2e-user-auth",
      "x-user-role": "user",
    },
    body: JSON.stringify({
      sessionId: "e2e-session-valid",
      message: "What is GraphRAG?",
    }),
  });

  assert.equal(response.status, 200);
  const data = (await response.json()) as {
    message: string;
    model: string;
    responseId: string;
    sources: unknown[];
  };

  assert.ok(data.message.length > 0);
  assert.ok(data.model);
  assert.ok(data.responseId);
  assert.ok(Array.isArray(data.sources));
});

test("E2E: /api/documents security enforcement (401 unauthenticated, 403 user role)", async () => {
  // Unauthenticated upload
  const unauthRes = await makeRequest("/api/documents/upload?filename=test.txt", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "Sample document content",
  });
  assert.equal(unauthRes.status, 401);

  // User role trying admin document upload
  const forbiddenRes = await makeRequest("/api/documents/upload?filename=test.txt", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-tenant-id": "e2e-doc-tenant",
      "x-user-id": "e2e-doc-user",
      "x-user-role": "user",
    },
    body: "Sample document content",
  });
  assert.equal(forbiddenRes.status, 403);
});

test("E2E: /api/documents admin lifecycle (upload, list, delete)", async () => {
  // Admin upload
  const uploadRes = await makeRequest("/api/documents/upload?filename=e2e-test-doc.txt", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-tenant-id": "e2e-doc-tenant",
      "x-user-id": "e2e-admin-user",
      "x-user-role": "admin",
    },
    body: "GraphRAG is a novel retrieval architecture combining vector embeddings with knowledge graphs.",
  });
  assert.equal(uploadRes.status, 201);
  const uploadData = (await uploadRes.json()) as { document: { id: string } };
  assert.ok(uploadData.document.id);

  // Admin list
  const listRes = await makeRequest("/api/documents", {
    method: "GET",
    headers: {
      "x-tenant-id": "e2e-doc-tenant",
      "x-user-id": "e2e-admin-user",
      "x-user-role": "admin",
    },
  });
  assert.equal(listRes.status, 200);
  const listData = (await listRes.json()) as { documents: Array<{ id: string }> };
  assert.ok(listData.documents.some((d) => d.id === uploadData.document.id));

  // Admin delete
  const deleteRes = await makeRequest(`/api/documents/${uploadData.document.id}`, {
    method: "DELETE",
    headers: {
      "x-tenant-id": "e2e-doc-tenant",
      "x-user-id": "e2e-admin-user",
      "x-user-role": "admin",
    },
  });
  assert.equal(deleteRes.status, 200);
});
