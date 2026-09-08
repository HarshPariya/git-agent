import type { LlmProvider, LlmRequest, LlmResponse } from "../types/llm.js";

export const mockProvider: LlmProvider = {
  generate: async ({ input }: LlmRequest): Promise<LlmResponse> => ({
    id: "mock-response",
    model: "mock",
    text: `Mock response for: ${input}`,
  }),
};
