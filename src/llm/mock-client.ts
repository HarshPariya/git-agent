import type { LlmProvider, LlmRequest, LlmResponse } from "../types/llm.js";

export const mockProvider: LlmProvider = {
  async generate({ input }: LlmRequest): Promise<LlmResponse> {
    return {
      id: "mock-response",
      model: "mock",
      text: `Mock response for: ${input}`,
    };
  },
};
