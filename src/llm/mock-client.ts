import type { LlmProvider, LlmRequest, LlmResponse } from "../types/llm.js";

export const mockProvider: LlmProvider = {
  generate: ({ input }: LlmRequest): Promise<LlmResponse> =>
    Promise.resolve({
      id: "mock-response",
      model: "mock",
      text: `Mock response for: ${input}`,
    }),
};
