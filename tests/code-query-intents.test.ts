import assert from "node:assert/strict";
import test from "node:test";

import { ConversationMemory } from "../src/agent/memory.js";
import { createAgent } from "../src/agent/orchestrator.js";
import { analyzeCodeQuery } from "../src/agent/code-query-intent.js";
import { routeQuery } from "../src/agent/retrieval-router.js";
import type { RetrievalRequest, RetrievalResult, Retriever } from "../src/retrieval/types.js";
import type { LlmProvider } from "../src/types/llm.js";

const llm: LlmProvider = {
  async generate({ input }) {
    return { id: "code-intent-mock", model: "mock", text: `Mock response for: ${input}` };
  },
};

class LocationRetriever implements Retriever {
  async search(request: RetrievalRequest): Promise<readonly RetrievalResult[]> {
    if (/references calls and usages of normalizeId/i.test(request.query)) {
      return [{
        content: "const fileEntityId = `file:${normalizeId(file.filePath)}`;",
        source: "src/graph/relationship-extractor.ts",
        score: 1,
      }];
    }
    if (/normalizeId/i.test(request.query)) {
      return [{
        content: "export function normalizeId(value: string) { return value.toLowerCase(); }",
        source: "src/graph/entity-extractor.ts",
        score: 1,
      }];
    }
    if (/runtime SELECT\/FROM SQL/i.test(request.query)) {
      return [{
        content: "SELECT id, 1 - (embedding <=> $1::vector) AS similarity FROM code_chunks",
        source: "src/db/vector-store.ts",
        score: 1,
      }];
    }
    if (/references calls and usages of pgVectorSearch/i.test(request.query)) {
      return [{
        content: "vectorResults = await pgVectorSearch(sanitizedQuery, options)",
        source: "src/retrieval/retriever.ts",
        score: 0.95,
      }];
    }
    if (/pgVectorSearch/i.test(request.query)) {
      return [{
        content: "export async function pgVectorSearch(...) {}",
        source: "src/db/vector-store.ts",
        score: 1,
        metadata: {
          type: "symbol_lookup",
          symbol: "pgVectorSearch",
          filePath: "src/db/vector-store.ts",
          startLine: "221",
          endLine: "270",
          pathValidated: "true",
        },
      }];
    }
    if (/CodeRetriever/i.test(request.query)) {
      return [{
        content: "export class CodeRetriever",
        source: "src/retrieval/retriever.ts",
        score: 1,
        metadata: {
          type: "symbol_lookup",
          symbol: "CodeRetriever",
          filePath: "src/retrieval/retriever.ts",
          startLine: "83",
          endLine: "350",
          pathValidated: "true",
        },
      }];
    }
    if (/UnifiedRetriever/i.test(request.query)) {
      return [{
        content: "export class UnifiedRetriever implements Retriever",
        source: "src/retrieval/unified-retriever.ts",
        score: 1,
        metadata: {
          type: "symbol_lookup",
          symbol: "UnifiedRetriever",
          filePath: "src/retrieval/unified-retriever.ts",
          startLine: "18",
          endLine: "105",
          pathValidated: "true",
        },
      }];
    }
    if (/critic\.ts/i.test(request.query)) {
      return [{
        content: "export const evaluateAnswer = ...",
        source: "src/agent/critic.ts",
        score: 1,
        metadata: {
          type: "file_lookup",
          requestedFilename: "critic.ts",
          filePath: "src/agent/critic.ts",
          pathValidated: "true",
        },
      }];
    }
    return [];
  }
}

const createTestAgent = () => createAgent(new ConversationMemory(), new LocationRetriever(), llm);
const run = (question: string) => createTestAgent().run({
  tenantId: "code-intent-tenant",
  sessionId: `session-${Math.random()}`,
  question,
  retrievalMode: "code",
});

test("FILE_LOCATION returns critic.ts path", async () => {
  const result = await run("Where is critic.ts?");
  assert.match(result.text, /src\/agent\/critic\.ts/i);
  assert.match(result.model, /deterministic-repository-lookup/);
});

test("LINE_RANGE returns exact source rather than a location", async () => {
  const result = await run("Show me lines 1-10 of critic.ts exactly.");
  assert.match(result.text, /lines 1-10/i);
  assert.match(result.text, /import type \{ CriticRequest, CriticResult \}/);
  assert.doesNotMatch(result.text, /exists at/i);
});

test("SYMBOL_LIST returns symbols defined in critic.ts", async () => {
  const result = await run("What functions are defined in critic.ts?");
  assert.match(result.text, /evaluateAnswer/);
  assert.match(result.text, /normalize/);
  assert.match(result.text, /getNumbers/);
  assert.doesNotMatch(result.text, /ValidationRule/);
  assert.match(result.text, /critic\.ts/i);
  assert.doesNotMatch(result.text, /exists at/i);
});

test("SYMBOL_LOCATION returns the symbol path and line range", async () => {
  const result = await run("Where is UnifiedRetriever defined?");
  assert.match(result.text, /src\/retrieval\/unified-retriever\.ts/i);
  assert.match(result.text, /lines 18-105/i);
});

test("RELATIONSHIP references both requested files and code evidence", async () => {
  const result = await run("Show me the relationship between chat.ts and unified-retriever.ts.");
  assert.match(result.text, /chat\.ts/i);
  assert.match(result.text, /unified-retriever\.ts/i);
  assert.match(result.text, /import|dependency|retrieval\/orchestration/i);
  assert.doesNotMatch(result.text, /exists at/i);
});

test("file-location follow-up resolves the latest discussed file from memory", async () => {
  const agent = createTestAgent();
  const context = {
    tenantId: "follow-up-tenant",
    sessionId: "follow-up-session",
    retrievalMode: "code" as const,
  };
  await agent.run({
    ...context,
    question: "Show me the relationship between chat.ts and unified-retriever.ts.",
  });
  const result = await agent.run({ ...context, question: "Where is this file?" });
  assert.match(result.text, /src\/retrieval\/unified-retriever\.ts/i);
  assert.doesNotMatch(result.text, /list_directory|parameters/i);
});

test("CODE_EXPLANATION contains implementation information", async () => {
  const result = await run("Explain what critic.ts does and how its main functions work.");
  assert.match(result.text, /implementation overview/i);
  assert.match(result.text, /evaluateAnswer/);
  assert.match(result.text, /Main implementation behavior/i);
  assert.match(result.text, /CRITIC_RULES|context|validation/i);
  assert.match(result.text, /source lines/i);
  assert.doesNotMatch(result.text, /exists at/i);
});

test("EXECUTION_TRACE follows chat.ts through UnifiedRetriever and CodeRetriever", async () => {
  const result = await run("Trace the execution flow from chat.ts to UnifiedRetriever and then to CodeRetriever.");
  assert.match(result.text, /chat\.ts/i);
  assert.match(result.text, /UnifiedRetriever/);
  assert.match(result.text, /CodeRetriever/);
  assert.match(result.text, /src\/retrieval\/unified-retriever\.ts/i);
  assert.match(result.text, /src\/retrieval\/retriever\.ts/i);
});

test("CALLER_SEARCH returns definition and at least one usage", async () => {
  const result = await run("Where is pgVectorSearch implemented, and which components call or use it?");
  assert.match(result.text, /src\/db\/vector-store\.ts/i);
  assert.match(result.text, /Callers and usages/i);
  assert.match(result.text, /src\/retrieval\/retriever\.ts/i);
});

test("direct where-is-used wording routes to CALLER_SEARCH", () => {
  const analysis = analyzeCodeQuery("Where is normalizeId used?");
  assert.equal(analysis.intent, "CALLER_SEARCH");
  assert.equal(analysis.symbol, "normalizeId");
});

test("graph search quick action routes to deterministic implementation explanation", () => {
  const analysis = analyzeCodeQuery("How does graph search work?");
  assert.equal(analysis.intent, "CODE_EXPLANATION");
  assert.deepEqual(analysis.filenames, ["graph-search.ts"]);
});

test("impact slash command routes to deterministic code impact analysis", () => {
  const analysis = analyzeCodeQuery("/impact traverseGraph");
  assert.equal(analysis.intent, "IMPACT_ANALYSIS");
  assert.equal(analysis.symbol, "traverseGraph");
  assert.equal(routeQuery({ query: "/impact traverseGraph" }).mode, "code");
});

test("file existence wording routes to deterministic location lookup", () => {
  const analysis = analyzeCodeQuery("In project we have package.json?");
  assert.equal(analysis.intent, "FILE_LOCATION");
  assert.deepEqual(analysis.filenames, ["package.json"]);
});

test("package.json existence check uses the filesystem instead of indexed chunks", async () => {
  const result = await run("In project we have package.json?");
  assert.match(result.text, /^Yes\./);
  assert.match(result.text, /package\.json/);
  assert.doesNotMatch(result.text, /retrieved evidence only includes/i);
});

test("raw tool-call text is rejected for an underspecified repair request", async () => {
  const rawToolLlm: LlmProvider = {
    async generate() {
      return {
        id: "raw-tool",
        model: "mock",
        text: 'tool_call\n{"name":"read_file","parameters":{"path":"ast-parser.ts"}}',
      };
    },
  };
  const agent = createAgent(new ConversationMemory(), new LocationRetriever(), rawToolLlm);
  const result = await agent.run({
    tenantId: "repair-tenant",
    sessionId: "repair-session",
    question: "There is error in ast-parser.ts solve it",
    retrievalMode: "code",
  });
  assert.match(result.text, /inspected .*ast-parser\.ts/i);
  assert.match(result.text, /exact error message|not enough evidence/i);
  assert.doesNotMatch(result.text, /tool_call|"name"\s*:\s*"read_file"/i);
});

test("DOCUMENT_PIPELINE covers upload through retrieval", async () => {
  const result = await run("Explain how an uploaded document goes from the upload API to document retrieval.");
  assert.match(result.text, /Upload API/i);
  assert.match(result.text, /parseDocumentContent/i);
  assert.match(result.text, /chunkDocument/i);
  assert.match(result.text, /indexDocument/i);
  assert.match(result.text, /DocumentRetriever/i);
  assert.doesNotMatch(result.text, /Retrieved evidence is required before answering/i);
});

test("ARCHITECTURE_TRACE includes the complete api chat execution path", async () => {
  const result = await run("Trace the full /api/chat architecture execution pipeline end-to-end.");
  for (const expected of [
    "chatHandler",
    "Security",
    "Orchestrator",
    "UnifiedRetriever",
    "CodeRetriever",
    "vector retrieval",
    "graph traversal",
    "Reranker",
    "LLM",
    "Critic",
    "Guardrails",
    "citations",
  ]) {
    assert.match(result.text, new RegExp(expected, "i"));
  }
  assert.doesNotMatch(result.text, /Retrieved evidence is required before answering/i);
});

test("retrieved evidence never leaks the internal retrieval placeholder", async () => {
  const failingLlm: LlmProvider = {
    async generate() {
      throw new Error("upstream unavailable");
    },
  };
  const evidenceRetriever: Retriever = {
    async search() {
      return [{
        content: "graphSearch traverses graph relationships and hybridSearch combines vector candidates.",
        source: "src/retrieval/graph-search.ts",
        score: 0.9,
      }];
    },
  };
  const agent = createAgent(new ConversationMemory(), evidenceRetriever, failingLlm);
  const result = await agent.run({
    tenantId: "fallback-tenant",
    sessionId: "fallback-session",
    question: "How does graph search work?",
    retrievalMode: "code",
  });
  assert.match(result.text, /graphSearch|graph relationships/i);
  assert.match(result.text, /src\/retrieval\/graph-search\.ts/i);
  assert.doesNotMatch(result.text, /Retrieved evidence is required before answering/i);
});

test("embedding storage verification continues through migration and runtime evidence", async () => {
  const result = await run([
    "Verify exactly where code embeddings are stored. Return only:",
    "verdict, table name, embedding column, vector dimension,",
    "migration file, and runtime file that reads from that table.",
    "Do not stop after saying you will search.",
  ].join("\n"));

  assert.doesNotMatch(result.text, /I need to|I will search|I need to inspect|Let me search/i);
  assert.match(result.text, /verdict:\s*VERIFIED/i);
  assert.match(result.text, /table name:\s*code_chunks/i);
  assert.match(result.text, /embedding column:\s*embedding/i);
  assert.match(result.text, /vector dimension:\s*384/i);
  assert.match(result.text, /migration file:\s*migrations\/001_initial_schema\.sql/i);
  assert.match(result.text, /runtime file:\s*src\/db\/vector-store\.ts/i);
});

test("planning-only model text is never returned as a final grounded answer", async () => {
  const planningLlm: LlmProvider = {
    async generate() {
      return { id: "planning", model: "mock", text: "I need to inspect the implementation before answering." };
    },
  };
  const retriever: Retriever = {
    async search() {
      return [{
        content: "export function implementation() { return 'grounded'; }",
        source: "src/example.ts",
        score: 1,
      }];
    },
  };
  const agent = createAgent(new ConversationMemory(), retriever, planningLlm);
  const result = await agent.run({
    tenantId: "planning-tenant",
    sessionId: "planning-session",
    question: "Explain the repository implementation.",
    retrievalMode: "code",
  });
  assert.doesNotMatch(result.text, /I need to inspect/i);
  assert.match(result.text, /src\/example\.ts|implementation/i);
});

test("requested multi-step query phrasings return semantic answers", async () => {
  const callers = await run("Which components call pgVectorSearch?");
  assert.match(callers.text, /src\/retrieval\/retriever\.ts/i);
  assert.doesNotMatch(callers.text, /I need to|I will search/i);

  const trace = await run("Trace /api/chat to vector retrieval.");
  assert.match(trace.text, /chatHandler|api\/chat/i);
  assert.match(trace.text, /UnifiedRetriever|CodeRetriever/i);
  assert.match(trace.text, /vector retrieval/i);

  const pipeline = await run("Explain the uploaded-document indexing pipeline.");
  assert.match(pipeline.text, /upload/i);
  assert.match(pipeline.text, /parseDocumentContent|parse/i);
  assert.match(pipeline.text, /chunkDocument|chunk/i);
  assert.match(pipeline.text, /indexDocument|index/i);
  assert.match(pipeline.text, /DocumentRetriever|retrieve/i);

  const normalizeCallers = await run("Find every runtime caller of normalizeId.");
  assert.match(normalizeCallers.text, /src\/graph\/relationship-extractor\.ts/i);
  assert.match(normalizeCallers.text, /normalizeId/i);
});
