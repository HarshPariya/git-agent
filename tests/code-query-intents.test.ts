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
