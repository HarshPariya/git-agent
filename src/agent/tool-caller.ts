import type Groq from "groq-sdk";

import {
  continueLlmWithTools,
  generateLlmWithTools,
  type LlmTool,
  type ToolLlmResponse,
} from "../llm/router.js";
import { ToolRegistry } from "../tools/registry.js";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../types/tools.js";

export interface ToolCallingRequest {
  readonly instructions: string;
  readonly input: string;
  readonly registry: ToolRegistry;
  readonly maxRounds: number;
  readonly context: ToolExecutionContext;
}

const toLlmTools = (
  registry: ToolRegistry,
  context: ToolExecutionContext,
): readonly LlmTool[] =>
  registry.list(context).map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

const executeTool = async (
  registry: ToolRegistry,
  call: ToolLlmResponse["toolCalls"][number],
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> => {
  try {
    const input: unknown = JSON.parse(call.arguments);
    const result = await registry.executeTool(call.name, input, context);

    return {
      toolName: call.name,
      callId: call.callId,
      success: result.success,
      output: result.output,
      error: result.error,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      toolName: call.name,
      callId: call.callId,
      success: false,
      output: undefined,
      error: error instanceof Error ? error.message : "Tool execution failed",
      durationMs: 0,
    };
  }
};

export async function runToolCalling({
  instructions,
  input,
  registry,
  maxRounds,
  context,
}: ToolCallingRequest): Promise<ToolLlmResponse> {
  const tools = toLlmTools(registry, context);
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
    round >= maxRounds &&
      (() => {
        throw new Error("Maximum tool-call rounds exceeded");
      })();

    messages.push(response.message);

    const outputs = await Promise.all(
      response.toolCalls.map((call) => executeTool(registry, call, context)),
    );

    messages.push(
      ...outputs.map(
        (result): Groq.Chat.Completions.ChatCompletionToolMessageParam => ({
          role: "tool",
          tool_call_id: result.callId,
          content: JSON.stringify({
            success: result.success,
            output: result.output,
            error: result.error,
            durationMs: result.durationMs,
          }),
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
