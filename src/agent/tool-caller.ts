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

/**
 * Maximum characters to include in a tool result serialization.
 * Prevents runaway context window growth from large file reads.
 */
const MAX_OUTPUT_CHARS = 4000;

export interface ToolCallingRequest {
  readonly instructions: string;
  readonly input: string;
  readonly registry: ToolRegistry;
  readonly maxRounds: number;
  readonly context: ToolExecutionContext;
  /** Optional callback fired after every tool execution. Used for toolActivity tracking. */
  readonly onToolResult?: (
    toolName: string,
    success: boolean,
    durationMs: number,
    error?: string,
  ) => void;
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

/**
 * Bounds the conversation history to prevent context window overflow.
 * Preserves the original user message and the most recent N exchanges.
 * Ensures no orphaned tool messages appear at the start of the bounded slice.
 */
const boundMessagesWithoutOrphans = (
  allMessages: readonly Groq.Chat.Completions.ChatCompletionMessageParam[],
): Groq.Chat.Completions.ChatCompletionMessageParam[] => {
  if (allMessages.length <= 12) {
    return [...allMessages];
  }

  const userMessage = allMessages[0]!;
  const recentSlice = allMessages.slice(-10);

  let validStartIndex = 0;
  while (
    validStartIndex < recentSlice.length &&
    recentSlice[validStartIndex]?.role === "tool"
  ) {
    validStartIndex++;
  }

  return [userMessage, ...recentSlice.slice(validStartIndex)];
};

/**
 * Synthesizes tool execution results into a readable text response when
 * the LLM returns an empty text after tool execution.
 *
 * This is the ONLY place where tool output formatting occurs. The orchestrator
 * never formats results — it delegates fully to this function.
 */
const synthesizeToolResults = (
  allExecutedResults: ToolExecutionResult[],
  executedTools: string[],
): string => {
  const formattedOutputs = allExecutedResults
    .filter((res) => res.success && res.output)
    .map((res) => {
      const data = res.output as Record<string, unknown>;

      // File content
      if (typeof data.content === "string" && data.content.trim().length > 0) {
        const ext = String(data.path || "").split(".").pop() || "";
        const pathLabel = data.path ? ` \`${data.path}\`` : "";
        return `### File${pathLabel}\n\n\`\`\`${ext}\n${data.content}\n\`\`\``;
      }

      // Write / edit / delete messages
      if (typeof data.message === "string" && data.message.trim().length > 0) {
        return `✅ **${res.toolName}**: ${data.message}`;
      }

      // Git / command output
      if (typeof data.output === "string" && data.output.trim().length > 0) {
        return `### \`${res.toolName}\` output\n\n\`\`\`text\n${data.output}\n\`\`\``;
      }

      // Directory listing
      if (Array.isArray(data.entries)) {
        const header = `### Directory: \`${String(data.path || ".")}\` (${data.totalEntries ?? data.entries.length} items)\n`;
        const list = (
          data.entries as Array<{
            name: string;
            relativePath: string;
            type: string;
          }>
        )
          .map(
            (e) =>
              `- ${e.type === "directory" ? "📁" : "📄"} \`${e.relativePath || e.name}\``,
          )
          .join("\n");
        return `${header}\n${list}`;
      }

      // Knowledge results
      if (Array.isArray(data.results)) {
        return (
          data.results as Array<{
            content: string;
            source: string;
            page?: number;
          }>
        )
          .map(
            (r) =>
              `> **[${r.source}${r.page ? ` p.${r.page}` : ""}]**\n${r.content}`,
          )
          .join("\n\n");
      }

      return JSON.stringify(res.output, null, 2);
    })
    .filter(Boolean)
    .join("\n\n");

  if (formattedOutputs.trim().length > 0) {
    return formattedOutputs;
  }

  if (executedTools.length > 0) {
    return `Successfully executed operations using: ${executedTools.join(", ")}.`;
  }

  return "Successfully completed requested tool operations.";
};

/**
 * runToolCalling — Autonomous multi-round tool execution loop.
 *
 * Delegates tool selection and argument generation entirely to the LLM.
 * The loop continues until:
 *   - The LLM returns no further tool calls, OR
 *   - maxRounds is reached (loop protection), OR
 *   - An unrecoverable error occurs in continueWithTools.
 *
 * Tool results are NEVER fabricated. If a tool fails, the failure is
 * passed faithfully to the LLM for its next decision.
 */
export async function runToolCalling({
  instructions,
  input,
  registry,
  maxRounds = 12,
  context,
  onToolResult,
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
  const allExecutedResults: ToolExecutionResult[] = [];

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
      allExecutedResults.push(output);
      if (output.success) executedTools.push(output.toolName);

      // Fire toolActivity callback for observability
      onToolResult?.(
        output.toolName,
        output.success,
        output.durationMs,
        output.error ?? undefined,
      );
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

  // LLM returned empty text after tool execution — synthesize from results
  const fallbackText = synthesizeToolResults(allExecutedResults, executedTools);

  return {
    ...response,
    text: fallbackText,
    message: {
      role: "assistant",
      content: fallbackText,
      ...(response.message.tool_calls !== undefined && {
        tool_calls: response.message.tool_calls,
      }),
    },
  };
}

export const toolCaller = {
  call: runToolCalling,
};
