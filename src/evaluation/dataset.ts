export interface EvaluationCase {
  readonly id: string;
  readonly question: string;
  readonly expectedResponseId: string;
  readonly expectRetrieval: boolean;
  readonly expectedSource?: string;
}

export const evaluationDataset: readonly EvaluationCase[] = [
  {
    id: "direct-graphrag",
    question: "What is GraphRAG?",
    expectedResponseId: "mock-general",
    expectRetrieval: false,
  },
  {
    id: "refund-policy",
    question: "What is the refund policy?",
    expectedResponseId: "mock-refund",
    expectRetrieval: true,
    expectedSource: "refund-policy.pdf",
  },
  {
    id: "product-pricing",
    question: "What about Product A pricing?",
    expectedResponseId: "mock-pricing",
    expectRetrieval: true,
    expectedSource: "product-a-pricing.pdf",
  },
];