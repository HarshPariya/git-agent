import crypto from "node:crypto";
import type Groq from "groq-sdk";

import {
  continueWithTools,
  generateWithTools,
  type LlmTool,
} from "../llm/client.js";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../types/tools.js";
import type { ToolLlmResponse } from "../types/llm.js";
import type { ToolRegistry } from "../tools/registry.js";
import { logger } from "../logging/logger.js";

const MAX_OUTPUT_CHARS = 2000;

export interface ToolCallingRequest {
  readonly instructions: string;
  readonly input: string;
  readonly registry: ToolRegistry;
  readonly maxRounds: number;
  readonly context: ToolExecutionContext;
  readonly generateLlmWithTools?: typeof generateWithTools;
  readonly continueLlmWithTools?: typeof continueWithTools;
}

const formatToolContent = (result: ToolExecutionResult): string => {
  const serialized = JSON.stringify(result);
  return serialized.length > MAX_OUTPUT_CHARS
    ? `${serialized.slice(0, MAX_OUTPUT_CHARS)}... [truncated]`
    : serialized;
};

export const toLlmTools = (
  registry: ToolRegistry,
  context: ToolExecutionContext,
): readonly LlmTool[] =>
  registry.list(context).map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

export const executeTool = async (
  registry: ToolRegistry,
  call: {
    readonly id?: string;
    readonly callId?: string;
    readonly name: string;
    readonly arguments: string;
  },
  context: ToolExecutionContext,
): Promise<ToolExecutionResult> => {
  const callId =
    call.id ?? call.callId ?? `call_${crypto.randomUUID().slice(0, 8)}`;
  try {
    const parsedArgs = JSON.parse(call.arguments || "{}") as unknown;
    const result = await registry.executeTool(call.name, parsedArgs, context);
    return {
      ...result,
      callId,
    };
  } catch (error) {
    return {
      toolName: call.name,
      callId,
      success: false,
      output: undefined,
      error: error instanceof Error ? error.message : "Invalid tool arguments",
      durationMs: 0,
    };
  }
};

const boundMessagesWithoutOrphans = (
  allMessages: readonly Groq.Chat.Completions.ChatCompletionMessageParam[],
): Groq.Chat.Completions.ChatCompletionMessageParam[] => {
  if (allMessages.length <= 12) {
    return [...allMessages];
  }

  const userMessage = allMessages[0]!;
  const recentSlice = allMessages.slice(-10);

  // Skip any leading tool messages that lost their assistant parent
  let validStartIndex = 0;
  while (
    validStartIndex < recentSlice.length &&
    recentSlice[validStartIndex]?.role === "tool"
  ) {
    validStartIndex++;
  }

  return [userMessage, ...recentSlice.slice(validStartIndex)];
};

export async function runToolCalling({
  instructions,
  input,
  registry,
  maxRounds = 12,
  context,
  generateLlmWithTools = generateWithTools,
  continueLlmWithTools = continueWithTools,
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

  const executedTools: string[] = [];

  for (
    let round = 0;
    response.toolCalls.length > 0 && round < maxRounds;
    round += 1
  ) {
    messages.push(response.message);

    const outputs = await Promise.all(
      response.toolCalls.map((call) => executeTool(registry, call, context)),
    );

    for (const output of outputs) {
      if (output.success) executedTools.push(output.toolName);
    }

    messages.push(
      ...outputs.map(
        (result): Groq.Chat.Completions.ChatCompletionToolMessageParam => ({
          role: "tool",
          tool_call_id: result.callId,
          content: formatToolContent(result),
        }),
      ),
    );

    const bounded = boundMessagesWithoutOrphans(messages);

    try {
      response = await continueLlmWithTools({
        instructions,
        messages: bounded,
        tools,
      });
    } catch (err) {
      logger.warn("continueWithTools round failed, ending tool loop", {
        operation: "tool_loop_continue",
        metadata: {
          round,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      break;
    }
  }

  const responseText = response.text.trim();
  if (responseText.length > 0) {
    return response;
  }

  const fallbackSummary =
    executedTools.length > 0
      ? `Successfully executed operations using: ${executedTools.join(", ")}.`
      : "Successfully completed requested tool operations.";

  return {
    ...response,
    text: fallbackSummary,
    message: {
      role: "assistant",
      content: fallbackSummary,
      ...(response.message.tool_calls !== undefined && {
        tool_calls: response.message.tool_calls,
      }),
    },
  };
}

export const toolCaller = {
  call: runToolCalling,
};
