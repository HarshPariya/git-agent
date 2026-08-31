import test from "node:test";
import assert from "node:assert/strict";

import { indexDocument } from "../src/ingestion/document-indexer.js";
import { parseDocumentContent } from "../src/ingestion/document-parser.js";
import { chunkDocument } from "../src/ingestion/document-chunker.js";
import { createAgent } from "../src/agent/orchestrator.js";
import { ConversationMemory } from "../src/agent/memory.js";
import { UnifiedRetriever } from "../src/retrieval/unified-retriever.js";
import { CodeRetriever } from "../src/retrieval/retriever.js";
import fs from "node:fs";
import path from "node:path";

test("DOCUMENT mode strictly isolates document RAG retrieval and excludes code chunks", async () => {
  const docId = "doc-test-prajapati-18";
  const tenantId = "test-tenant-iso";
  const textContent = `
Player Roster & Jersey Numbers 2026:
- Player Prajapati wears jersey number 18.
- Player Rishabh wears jersey number 17.
- Player Vikas wears jersey number 45.
  `.trim();

  const metadata = {
    documentId: docId,
    filename: "JERSEY.pdf",
    mimeType: "application/pdf",
    tenantId,
    userId: "test-user",
  };

  const parsed = await parseDocumentContent(
    Buffer.from(textContent, "utf8"),
    "JERSEY.txt",
    metadata,
  );

  const docChunks = chunkDocument(parsed);
  await indexDocument(metadata, Buffer.byteLength(textContent), docChunks);

  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();
  const unifiedRetriever = new UnifiedRetriever(codeRetriever);
  const memory = new ConversationMemory();

  // Mock LLM provider that asserts evidence content
  const mockLLM = {
    generate: async (params: { instructions: string; input: string }) => {
      assert.ok(params.instructions.includes("document assistant"));
      assert.ok(!params.input.includes("ast-parser.ts"));
      assert.ok(!params.input.includes("critic.ts"));
      assert.ok(params.input.includes("Prajapati"));
      assert.ok(params.input.includes("18"));

      return {
        text: "Prajapati wears jersey number 18 [S1].",
        model: "mock-llm",
        id: "resp-123",
      };
    },
  };

  const agent = createAgent(memory, unifiedRetriever, mockLLM);

  const result = await agent.run({
    tenantId,
    sessionId: "test-session",
    question: "What is Prajapati's jersey number?",
    documentIds: [docId],
    retrievalMode: "document",
  });

  // Assertions
  assert.ok(result.text.includes("18"), "Response text must contain jersey number 18");
  assert.ok(result.sources.length > 0, "Must return document sources");

  for (const source of result.sources) {
    const sType = (source as any).sourceType;
    const sId = (source as any).documentId;

    assert.equal(sType, "document", "Every source must have sourceType === 'document'");
    if (sId) {
      assert.equal(sId, docId, "Source documentId must match selected documentId");
    }

    assert.ok(
      !source.source.includes("src/"),
      "No source path can belong to code src/",
    );
    assert.ok(
      !source.source.includes("ast-parser.ts"),
      "No source path can be ast-parser.ts",
    );
    assert.ok(
      !source.source.includes("critic.ts"),
      "No source path can be critic.ts",
    );
  }
});

test("CODE vs DOCUMENT vs MIXED modes route retrieval correctly", async () => {
  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();
  const unifiedRetriever = new UnifiedRetriever(codeRetriever);

  // 1. DOCUMENT mode
  const docResults = await unifiedRetriever.search({
    query: "Prajapati jersey",
    tenantId: "test-tenant-iso",
    documentIds: ["doc-test-prajapati-18"],
    mode: "document",
  });

  for (const r of docResults) {
    assert.equal(r.sourceType, "document");
  }
  const hasCodeInDocMode = docResults.some((r) => r.sourceType === "code");
  assert.equal(hasCodeInDocMode, false, "DOCUMENT mode must have zero code results");

  // 2. CODE mode
  const codeResults = await unifiedRetriever.search({
    query: "createPlan",
    tenantId: "test-tenant-iso",
    mode: "code",
  });

  for (const r of codeResults) {
    assert.equal(r.sourceType, "code");
  }
  const hasDocInCodeMode = codeResults.some((r) => r.sourceType === "document");
  assert.equal(hasDocInCodeMode, false, "CODE mode must have zero document results");

  // 3. MIXED mode
  const mixedResults = await unifiedRetriever.search({
    query: "Prajapati createPlan",
    tenantId: "test-tenant-iso",
    documentIds: ["doc-test-prajapati-18"],
    mode: "mixed",
  });

  assert.ok(mixedResults.length > 0, "MIXED mode must return results");

  const systemResults = await unifiedRetriever.search({
    query: "Check request logs",
    tenantId: "test-tenant-iso",
    documentIds: ["doc-test-prajapati-18"],
    mode: "system",
  });
  assert.equal(systemResults.length, 0, "SYSTEM mode must not search selected documents or code");
});

test("code retrieval resolves an explicitly named static file", async () => {
  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();

  const results = await codeRetriever.search({ query: "Where is index.html?", limit: 4 });

  assert.ok(results.length > 0);
  assert.ok(results[0]?.source.replace(/\\/g, "/").endsWith("/public/index.html"));
});

test("filename lookup is deterministic for exact hits and absence", async () => {
  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();

  const critic = await codeRetriever.search({ query: "Where is critic.ts?", limit: 4 });
  assert.ok(critic[0]?.source.replace(/\\/g, "/").endsWith("/src/agent/critic.ts"));

  const missing = await codeRetriever.search({ query: "Where is agent.ts?", limit: 4 });
  assert.equal(missing.length, 1);
  assert.match(missing[0]?.content ?? "", /No agent\.ts file exists/i);
  assert.equal(missing[0]?.source, "repository-index");
});

test("symbol location metadata points to an existing indexed file", async () => {
  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();

  const results = await codeRetriever.search({ query: "Where is traverseGraph implemented?", limit: 4 });

  assert.equal(results[0]?.metadata?.type, "symbol_lookup");
  assert.equal(results[0]?.metadata?.filePath, "src/graph/graph-builder.ts");
  assert.equal(results[0]?.metadata?.startLine, "138");
  assert.equal(fs.existsSync(path.resolve(results[0]?.metadata?.filePath ?? "")), true);

  const agent = createAgent(
    new ConversationMemory(),
    new UnifiedRetriever(codeRetriever),
    { generate: async () => { throw new Error("LLM must not generate symbol paths"); } },
  );
  const answer = await agent.run({
    tenantId: "symbol-tenant", sessionId: "symbol-session",
    question: "Where is traverseGraph implemented?", retrievalMode: "code",
  });
  assert.match(answer.text, /src\/graph\/graph-builder\.ts/);
  assert.doesNotMatch(answer.text, /src\/graph\/traverseGraph\.ts/);
});

test("code to document summary switch does not leak code evidence", async () => {
  const tenantId = "test-tenant-summary-switch";
  const documentId = "doc-test-player-summary";
  const playerText = `Sports Team Information

Player: Rahul Prajapati
Jersey Number: 18
Position: Midfielder

Player: Jay Patel
Jersey Number: 7
Position: Defender

The team captain is Rahul Prajapati.
The team trains every Monday and Thursday.`;
  const metadata = {
    documentId,
    filename: "TEST-PLAYER.txt",
    mimeType: "text/plain",
    tenantId,
    userId: "test-user",
  };
  const parsed = await parseDocumentContent(Buffer.from(playerText), metadata.filename, metadata);
  await indexDocument(metadata, Buffer.byteLength(playerText), chunkDocument(parsed));

  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();
  const unified = new UnifiedRetriever(codeRetriever);
  let lastResults: readonly any[] = [];
  const trackedRetriever = {
    search: async (request: any) => {
      lastResults = await unified.search(request);
      return lastResults;
    },
  };
  const mockLLM = {
    generate: async ({ instructions, input }: { instructions: string; input: string }) => {
      if (instructions.includes("Rewrite the user's latest question")) {
        return {
          text: input.split("Latest question:\n").at(-1)?.trim() ?? "",
          model: "mock",
          id: "rewrite",
        };
      }
      if (instructions.includes("document assistant") && input.includes("User question:\nWhat is Prajapati's jersey number?")) {
        assert.ok(!input.includes("critic.ts"));
        return {
          text: "Rahul Prajapati's jersey number is 18 [S1].",
          model: "mock",
          id: "document-fact",
        };
      }
      if (instructions.includes("document assistant") && input.includes("User question:\nWho is the team captain?")) {
        return { text: "The team captain is Rahul Prajapati [S1].", model: "mock", id: "captain" };
      }
      if (instructions.includes("document assistant") && input.includes("User question:\nWhen does the team train?")) {
        return { text: "The team trains every Monday and Thursday [S1].", model: "mock", id: "training" };
      }
      if (instructions.includes("document assistant") && input.includes("User question:\nWhat is Prajapati's age?")) {
        return { text: "Prajapati's age is not available in the document [S1].", model: "mock", id: "unknown" };
      }
      if (instructions.includes("document assistant") && input.includes("User question:\nWhat is this document about?")) {
        assert.ok(!input.includes("traverseGraph"));
        assert.ok(!input.includes("CodeGraph"));
        assert.ok(!input.includes("graph-builder.ts"));
        assert.ok(input.includes("Rahul Prajapati"));
        assert.ok(input.includes("Monday and Thursday"));
        return {
          text: "The document contains sports team information including players, jersey numbers, positions, the team captain, and the Monday and Thursday training schedule [S1].",
          model: "mock",
          id: "summary",
        };
      }
      return {
        text: "traverseGraph is implemented in the graph search code using CodeGraph and BFS [S1].",
        model: "mock",
        id: "code",
      };
    },
  };
  const agent = createAgent(new ConversationMemory(), trackedRetriever, mockLLM);

  await agent.run({
    tenantId,
    sessionId: "switch-session",
    question: "Where is traverseGraph implemented?",
    retrievalMode: "code",
  });
  const summary = await agent.run({
    tenantId,
    sessionId: "switch-session",
    question: "What is this document about?",
    documentIds: [documentId],
    retrievalMode: "document",
  });

  assert.ok(lastResults.length > 0);
  assert.ok(lastResults.every((result) => result.sourceType === "document"));
  assert.ok(summary.sources.every((source: any) => source.sourceType === "document"));
  assert.ok(summary.sources.every((source) => source.source === "TEST-PLAYER.txt"));
  assert.doesNotMatch(summary.text, /traverseGraph|CodeGraph|BFS|graph-builder\.ts/i);
  assert.match(summary.text, /players|jersey numbers|team|training/i);

  const codeAgain = await agent.run({
    tenantId,
    sessionId: "switch-session",
    question: "Where is critic.ts?",
    retrievalMode: "code",
  });
  assert.ok(codeAgain.sources.every((source: any) => source.sourceType === "code"));
  assert.ok(codeAgain.sources.some((source) => source.source.replace(/\\/g, "/").endsWith("/src/agent/critic.ts")));

  const documentAgain = await agent.run({
    tenantId,
    sessionId: "switch-session",
    question: "What is Prajapati's jersey number?",
    documentIds: [documentId],
    retrievalMode: "document",
  });
  assert.match(documentAgain.text, /18/);
  assert.ok(documentAgain.sources.every((source: any) => source.sourceType === "document"));
  assert.doesNotMatch(documentAgain.text, /critic\.ts|traverseGraph|CodeGraph|BFS/i);

  const captain = await agent.run({
    tenantId, sessionId: "switch-session", question: "Who is the team captain?",
    documentIds: [documentId], retrievalMode: "document",
  });
  assert.match(captain.text, /Rahul Prajapati/);

  const training = await agent.run({
    tenantId, sessionId: "switch-session", question: "When does the team train?",
    documentIds: [documentId], retrievalMode: "document",
  });
  assert.match(training.text, /Monday and Thursday/);

  const unknown = await agent.run({
    tenantId, sessionId: "switch-session", question: "What is Prajapati's age?",
    documentIds: [documentId], retrievalMode: "document",
  });
  assert.match(unknown.text, /not available/i);
  assert.ok(unknown.sources.every((source: any) => source.sourceType === "document"));
});

test("Broad summary question 'what is in document' retrieves representative document chunks", async () => {
  const codeRetriever = new CodeRetriever(process.cwd());
  await codeRetriever.initialize();
  const unifiedRetriever = new UnifiedRetriever(codeRetriever);

  const docResults = await unifiedRetriever.search({
    query: "what is in document",
    tenantId: "test-tenant-iso",
    documentIds: ["doc-test-prajapati-18"],
    mode: "document",
  });

  assert.ok(docResults.length > 0, "Broad summary query must return representative document candidates");
  for (const r of docResults) {
    assert.equal(r.sourceType, "document");
  }
});
