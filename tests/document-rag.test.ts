import test from "node:test";
import assert from "node:assert/strict";

import { parseDocumentContent, validateDocumentFile } from "../src/ingestion/document-parser.js";
import { chunkDocument } from "../src/ingestion/document-chunker.js";
import { routeQuery } from "../src/agent/retrieval-router.js";
import { getDocumentSearchKeyword } from "../src/retrieval/document-retriever.js";
import { DocumentRetriever } from "../src/retrieval/document-retriever.js";
import { indexDocument } from "../src/ingestion/document-indexer.js";

test("validates document extensions and rejects unsupported files", () => {
  assert.throws(
    () => validateDocumentFile("malicious.exe", 1024),
    /Unsupported document format/,
  );
});

test("rejects oversized document files exceeding 10MB", () => {
  assert.throws(
    () => validateDocumentFile("large-spec.pdf", 15 * 1024 * 1024),
    /exceeds 10MB maximum limit/,
  );
});

test("parses and chunks plain text and markdown documents correctly", async () => {
  const sampleText = `
# Company Leave Policy

Employees are entitled to 20 days of paid annual leave per calendar year.
All leave requests must be submitted at least 2 weeks in advance.

## Remote Work Policy

Remote work is allowed up to 2 days per week with manager approval.
  `.trim();

  const metadata = {
    documentId: "doc-test-101",
    filename: "leave-policy.md",
    mimeType: "text/markdown",
    tenantId: "tenant-alpha",
    userId: "user-001",
  };

  const parsed = await parseDocumentContent(
    Buffer.from(sampleText, "utf8"),
    metadata.filename,
    metadata,
  );

  assert.equal(parsed.sections.length >= 1, true);

  const chunks = chunkDocument(parsed);
  assert.equal(chunks.length >= 1, true);
  assert.equal(chunks[0]?.documentId, "doc-test-101");
  assert.equal(chunks[0]?.tenantId, "tenant-alpha");
});

test("routes queries accurately between code, document, and mixed modes", () => {
  const codeRoute = routeQuery({ query: "Where is authenticateUser called?", hasUploadedDocuments: true });
  assert.equal(codeRoute.mode, "code");

  const docRoute = routeQuery({ query: "What does the uploaded PDF say about leave policy?", hasUploadedDocuments: true });
  assert.equal(docRoute.mode, "document");

  const mixedRoute = routeQuery({ query: "Does our code implementation match the uploaded API specification?", hasUploadedDocuments: true });
  assert.equal(mixedRoute.mode, "mixed");

  const systemRoute = routeQuery({ query: "Check request logs", hasUploadedDocuments: true });
  assert.equal(systemRoute.mode, "system");

  const generalRoute = routeQuery({ query: "What is RAG?", hasUploadedDocuments: true });
  assert.equal(generalRoute.mode, "general");

  const entityRoute = routeQuery({ query: "RISHABH", hasUploadedDocuments: true });
  assert.equal(entityRoute.mode, "document");

  const summaryRoute = routeQuery({ query: "What is this document about?", hasUploadedDocuments: true });
  assert.equal(summaryRoute.mode, "document");

  const codeAfterDocumentRoute = routeQuery({ query: "Where is critic.ts?", hasUploadedDocuments: true });
  assert.equal(codeAfterDocumentRoute.mode, "code");
});

test("document lexical retrieval ignores question and file-type stop words", () => {
  assert.equal(getDocumentSearchKeyword("what is task name in pdf"), "task");
  assert.equal(getDocumentSearchKeyword("What is the employee policy?"), "employee");
  assert.equal(getDocumentSearchKeyword("where is agents.py?"), "agent");
});

test("document summaries cover the beginning, middle, and end of long documents", async () => {
  const tenantId = "summary-coverage-tenant";
  const documentId = "summary-coverage-document";
  const chunks = Array.from({ length: 50 }, (_, chunkIndex) => ({
    id: `${documentId}-${chunkIndex}`,
    documentId,
    tenantId,
    filename: "LONG.txt",
    pageNumber: chunkIndex + 1,
    section: `Section ${chunkIndex + 1}`,
    chunkIndex,
    content: `Representative content marker ${chunkIndex}`,
    contentHash: `hash-${chunkIndex}`,
  }));
  await indexDocument({
    documentId, filename: "LONG.txt", mimeType: "text/plain", tenantId, userId: "user",
  }, 1_000, chunks);

  const results = await new DocumentRetriever().search({
    query: "What is this document about?", tenantId, documentIds: [documentId], limit: 4,
  });

  assert.equal(results.length, 4);
  assert.ok(results.some((result) => result.content.includes("marker 0")));
  assert.ok(results.some((result) => result.content.includes("marker 49")));
});

test("document hybrid retrieval strongly ranks exact names and numbers", async () => {
  const tenantId = "lexical-document-tenant";
  const documentId = "lexical-jersey-document";
  const chunks = [
    { content: "Player: Rahul Prajapati | Jersey Number: 18", chunkIndex: 0 },
    { content: "Player: Rishabh | Jersey Number: 28", chunkIndex: 1 },
  ].map(({ content, chunkIndex }) => ({
    id: `${documentId}-${chunkIndex}`, documentId, tenantId, filename: "JERSEY.pdf",
    pageNumber: chunkIndex + 1, section: `Page ${chunkIndex + 1}`, chunkIndex, content,
    contentHash: `lexical-${chunkIndex}`,
  }));
  await indexDocument({
    documentId, filename: "JERSEY.pdf", mimeType: "application/pdf", tenantId, userId: "user",
  }, 500, chunks);

  const retriever = new DocumentRetriever();
  const numeric = await retriever.search({
    query: "WHO JERSEY NUMBER IS 28", tenantId, documentIds: [documentId], limit: 2,
  });
  assert.match(numeric[0]?.content ?? "", /Rishabh.*28/i);

  const name = await retriever.search({
    query: "RISHABH", tenantId, documentIds: [documentId], limit: 2,
  });
  assert.match(name[0]?.content ?? "", /Rishabh.*28/i);
});
