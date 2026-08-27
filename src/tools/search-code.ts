import {
  CodeRetriever,
  type RetrievedContext,
} from "../retrieval/retriever.js";

let retriever: CodeRetriever | null = null;
let initialized = false;

async function getRetriever(): Promise<CodeRetriever> {
  if (!retriever) {
    retriever = new CodeRetriever(process.cwd());
  }

  if (!initialized) {
    await retriever.initialize();
    initialized = true;
  }

  return retriever;
}

export interface SearchCodeInput {
  query: string;
  limit?: number;
}

export interface SearchCodeResult {
  query: string;
  results: RetrievedContext[];
}

export async function searchCode(
  input: SearchCodeInput,
): Promise<SearchCodeResult> {
  if (!input.query.trim()) {
    throw new Error(
      "searchCode requires a non-empty query.",
    );
  }

  const codeRetriever =
    await getRetriever();

  const results =
    await codeRetriever.retrieve(
      input.query,
      {
        limit: input.limit ?? 8,
      },
    );

  return {
    query: input.query,
    results,
  };
}
