import crypto from "node:crypto";
import Groq from "groq-sdk";

import { env } from "../config/env.js";
import { mockProvider } from "./mock-client.js";
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmTool,
  ToolCall,
  ToolLlmResponse,
} from "../types/llm.js";

export type { LlmTool, ToolLlmResponse };

const MAX_COMPLETION_TOKENS = 4096;

const client = new Groq({
  apiKey: env.groqApiKey,
});

const toToolCalls = (
  rawCalls: readonly Groq.Chat.Completions.ChatCompletionMessageToolCall[],
): readonly ToolCall[] =>
  rawCalls.map((call) => ({
    callId: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));

const stripThinkingTags = (content: string): string =>
  content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

const parseXmlToolCalls = (
  content: string,
): { toolCalls: ToolCall[]; cleanContent: string } => {
  const toolCalls: ToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as {
        name?: string;
        arguments?: Record<string, unknown> | string;
      };
      if (parsed.name) {
        toolCalls.push({
          callId: `call_${crypto.randomUUID().slice(0, 8)}`,
          name: parsed.name,
          arguments:
            typeof parsed.arguments === "object"
              ? JSON.stringify(parsed.arguments)
              : String(parsed.arguments ?? "{}"),
        });
      }
    } catch {
      // Ignored malformed XML chunk
    }
  }

  const cleanContent = content
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .trim();
  return { toolCalls, cleanContent };
};

const extractFailedGeneration = (err: unknown): string | null => {
  if (typeof err === "object" && err !== null) {
    const errorObj = (err as Record<string, unknown>).error as
      | Record<string, unknown>
      | undefined;
    if (typeof errorObj?.failed_generation === "string") {
      return errorObj.failed_generation;
    }
  }
  const str = String(err);
  const match = /"failed_generation":\s*"([\s\S]*?)"\s*[,}]/.exec(str);
  if (match && match[1]) {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1];
    }
  }
  return null;
};

const recoverToolCallsFromFailedGeneration = (
  failedGen: string,
): { toolCalls: ToolCall[]; cleanContent: string } => {
  if (failedGen.includes("<tool_call>")) {
    return parseXmlToolCalls(failedGen);
  }

  try {
    const parsed = JSON.parse(failedGen.trim()) as {
      name?: string;
      arguments?: Record<string, unknown> | string;
    };
    if (parsed && typeof parsed.name === "string") {
      const callId = `call_${crypto.randomUUID().slice(0, 8)}`;
      const argsStr =
        typeof parsed.arguments === "object"
          ? JSON.stringify(parsed.arguments)
          : String(parsed.arguments || "{}");
      return {
        toolCalls: [
          {
            callId,
            name: parsed.name,
            arguments: argsStr,
          },
        ],
        cleanContent: "",
      };
    }
  } catch {
    const nameMatch = /"name":\s*"([^"]+)"/.exec(failedGen);
    const argsMatch = /"arguments":\s*({[\s\S]*})/.exec(failedGen);
    if (nameMatch && nameMatch[1]) {
      const callId = `call_${crypto.randomUUID().slice(0, 8)}`;
      return {
        toolCalls: [
          {
            callId,
            name: nameMatch[1],
            arguments: argsMatch?.[1] ?? "{}",
          },
        ],
        cleanContent: "",
      };
    }
  }

  return { toolCalls: [], cleanContent: "" };
};

export const generateText = async ({
  instructions,
  input,
}: LlmRequest): Promise<LlmResponse> => {
  try {
    const response = await client.chat.completions.create({
      model: env.groqModel,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        {
          role: "system",
          content: instructions,
        },
        {
          role: "user",
          content: input,
        },
      ],
    });

    const rawText = response.choices[0]?.message.content?.trim() ?? "";
    const text = stripThinkingTags(rawText);

    if (!text) {
      throw new Error("LLM returned an empty response");
    }

    return {
      id: response.id,
      model: response.model,
      text,
    };
  } catch (error) {
    if (process.env.NODE_ENV === "test" || env.nodeEnv === "test") {
      return mockProvider.generate({ instructions, input });
    }
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Groq text generation failed");
  }
};

export const groqProvider: LlmProvider = {
  generate: generateText,
};

export const generateWithTools = async ({
  instructions,
  input,
  tools,
}: {
  readonly instructions: string;
  readonly input: string;
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> => {
  try {
    const response = await client.chat.completions.create({
      model: env.groqModel,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        {
          role: "system",
          content: instructions,
        },
        {
          role: "user",
          content: input,
        },
      ],
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as Record<string, unknown>,
        },
      })),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const message = choice?.message;
    const rawContent = stripThinkingTags(message?.content ?? "");

    let toolCalls: readonly ToolCall[] = message?.tool_calls
      ? toToolCalls(message.tool_calls)
      : [];

    let text = rawContent.trim();

    if (toolCalls.length === 0 && rawContent.includes("<tool_call>")) {
      const parsed = parseXmlToolCalls(rawContent);
      if (parsed.toolCalls.length > 0) {
        toolCalls = parsed.toolCalls;
        text = parsed.cleanContent;
      }
    }

    return {
      id: response.id,
      model: response.model,
      text,
      toolCalls,
      message: {
        role: "assistant",
        content: message?.content ?? null,
        ...(message?.tool_calls !== undefined && {
          tool_calls: message.tool_calls,
        }),
      },
    };
  } catch (err) {
    const failedGen = extractFailedGeneration(err);
    if (failedGen) {
      const parsed = recoverToolCallsFromFailedGeneration(failedGen);
      if (parsed.toolCalls.length > 0) {
        return {
          id: `recovered-${crypto.randomUUID()}`,
          model: env.groqModel,
          text: parsed.cleanContent,
          toolCalls: parsed.toolCalls,
          message: {
            role: "assistant",
            content: parsed.cleanContent || null,
            tool_calls: parsed.toolCalls.map((tc) => ({
              id: tc.callId,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          },
        };
      }
    }
    throw err;
  }
};

export const continueWithTools = async ({
  instructions,
  messages,
  tools,
}: {
  readonly instructions: string;
  readonly messages: readonly Groq.Chat.Completions.ChatCompletionMessageParam[];
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> => {
  try {
    const response = await client.chat.completions.create({
      model: env.groqModel,
      max_tokens: MAX_COMPLETION_TOKENS,
      messages: [
        {
          role: "system",
          content: instructions,
        },
        ...messages,
      ],
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as Record<string, unknown>,
        },
      })),
      tool_choice: "auto",
    });

    const choice = response.choices[0];
    const message = choice?.message;
    const rawContent = stripThinkingTags(message?.content ?? "");

    let toolCalls: readonly ToolCall[] = message?.tool_calls
      ? toToolCalls(message.tool_calls)
      : [];

    let text = rawContent.trim();

    if (toolCalls.length === 0 && rawContent.includes("<tool_call>")) {
      const parsed = parseXmlToolCalls(rawContent);
      if (parsed.toolCalls.length > 0) {
        toolCalls = parsed.toolCalls;
        text = parsed.cleanContent;
      }
    }

    return {
      id: response.id,
      model: response.model,
      text,
      toolCalls,
      message: {
        role: "assistant",
        content: message?.content ?? null,
        ...(message?.tool_calls !== undefined && {
          tool_calls: message.tool_calls,
        }),
      },
    };
  } catch (err) {
    const failedGen = extractFailedGeneration(err);
    if (failedGen) {
      const parsed = recoverToolCallsFromFailedGeneration(failedGen);
      if (parsed.toolCalls.length > 0) {
        return {
          id: `recovered-${crypto.randomUUID()}`,
          model: env.groqModel,
          text: parsed.cleanContent,
          toolCalls: parsed.toolCalls,
          message: {
            role: "assistant",
            content: parsed.cleanContent || null,
            tool_calls: parsed.toolCalls.map((tc) => ({
              id: tc.callId,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: tc.arguments,
              },
            })),
          },
        };
      }
    }
    throw err;
  }
};
