import type Groq from "groq-sdk";

import {
  continueLlmWithTools,
  generateLlmWithTools,
  type LlmTool,
  type ToolLlmResponse,
} from "../llm/router.js";
import { ToolRegistry } from "../tools/registry.js";

export interface ToolCallingRequest {
  readonly instructions: string;
  readonly input: string;
  readonly registry: ToolRegistry;
  readonly maxRounds: number;
}

const toLlmTools = (registry: ToolRegistry): readonly LlmTool[] =>
  registry.list().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

const executeTool = async (
  registry: ToolRegistry,
  call: ToolLlmResponse["toolCalls"][number],
): Promise<{
  readonly callId: string;
  readonly output: string;
}> => {
  try {
    const input: unknown = JSON.parse(call.arguments);
    const tool = registry.getRuntime(call.name);
    const result = await tool.execute(input);

    return {
      callId: call.callId,
      output: JSON.stringify(result),
    };
  } catch (error) {
    return {
      callId: call.callId,
      output: JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed",
      }),
    };
  }
};

export async function runToolCalling({
  instructions,
  input,
  registry,
  maxRounds,
}: ToolCallingRequest): Promise<ToolLlmResponse> {
  const tools = toLlmTools(registry);
  const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "user",
      content: input,
    },
  ];

  let response = await generateLlmWithTools({
    instructions,
    input,
    tools,
  });

  for (let round = 0; response.toolCalls.length > 0; round += 1) {
    if (round >= maxRounds) {
      throw new Error("Maximum tool-call rounds exceeded");
    }

    messages.push(response.message);

    const outputs = await Promise.all(
      response.toolCalls.map((call) => executeTool(registry, call)),
    );

    messages.push(
      ...outputs.map(
        ({
          callId,
          output,
        }): Groq.Chat.Completions.ChatCompletionToolMessageParam => ({
          role: "tool",
          tool_call_id: callId,
          content: output,
        }),
      ),
    );

    response = await continueLlmWithTools({
      instructions,
      messages,
      tools,
    });
  }

  return response;
}
