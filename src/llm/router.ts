import {
  continueWithTools,
  generateText,
  generateWithTools,
  type LlmTool,
  type ToolLlmResponse,
} from "./client.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../types/llm.js";

export type { LlmProvider, LlmRequest, LlmResponse };
export type { LlmTool, ToolLlmResponse };

export const generateWithLlm = (request: LlmRequest): Promise<LlmResponse> =>
  generateText(request);

export const generateLlmWithTools = ({
  instructions,
  input,
  tools,
}: {
  readonly instructions: string;
  readonly input: string;
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> =>
  generateWithTools({
    instructions,
    input,
    tools,
  });

export const continueLlmWithTools = ({
  instructions,
  messages,
  tools,
}: {
  readonly instructions: string;
  readonly messages: Parameters<typeof continueWithTools>[0]["messages"];
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> =>
  continueWithTools({
    instructions,
    messages,
    tools,
  });
