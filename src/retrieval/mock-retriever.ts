import type { RetrievalRequest, RetrievalResult, Retriever } from "./types.js";

const MOCK_RESULTS: readonly RetrievalResult[] = [
  {
    content: "The refund period is 30 days from the purchase date.",
    source: "refund-policy.pdf",
    page: 4,
    score: 0.98,
  },
  {
    content:
      "Enterprise customers are eligible for the standard refund policy.",
    source: "enterprise-policy.pdf",
    page: 7,
    score: 0.91,
  },
  {
    content: "Product A is the company's standard enterprise product.",
    source: "product-a.pdf",
    page: 2,
    score: 0.95,
  },
  {
    content: "Product A is priced at $99 per month.",
    source: "product-a-pricing.pdf",
    page: 3,
    score: 0.94,
  },
];

const RETRIEVAL_TERMS = [
  "refund",
  "return",
  "reimbursement",
  "pricing",
  "price",
  "cost",
  "product",
  "policy",
] as const;

const hasRetrievalIntent = (query: string): boolean =>
  RETRIEVAL_TERMS.some((term) => query.includes(term));

const getResults = (query: string): readonly RetrievalResult[] => {
  switch (true) {
    case query.includes("pricing") ||
      query.includes("price") ||
      query.includes("cost"):
      return MOCK_RESULTS.slice(2);

    case query.includes("refund") ||
      query.includes("return") ||
      query.includes("reimbursement") ||
      query.includes("policy"):
      return MOCK_RESULTS.slice(0, 2);

    case query.includes("product"):
      return MOCK_RESULTS.slice(2, 3);

    default:
      return [];
  }
};

export class MockRetriever implements Retriever {
  async search(request: RetrievalRequest): Promise<readonly RetrievalResult[]> {
    const query = request.query.trim().toLowerCase();
    const limit = request.limit ?? MOCK_RESULTS.length;

    switch (hasRetrievalIntent(query)) {
      case true:
        return getResults(query).slice(0, limit);

      default:
        return [];
    }
  }
}
