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

const FALLBACK_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  env.groqModel,
];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const isTransientLlmError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  const status = Number(e.status ?? (e as { error?: { status?: number } }).error?.status);
  const msg = String(e.message || e.error || "");
  const name = String(e.name || "");

  return (
    status === 429 ||
    status === 503 ||
    status === 500 ||
    status === 502 ||
    status === 504 ||
    name === "APIConnectionError" ||
    name === "APIConnectionTimeoutError" ||
    msg.includes("Connection error") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("rate_limit")
  );
};

const extractRetryDelayMs = (err: unknown): number => {
  const str = String(err);
  const match = /try again in (\d+(?:\.\d+)?)s/i.exec(str);
  if (match && match[1]) {
    return Math.ceil(parseFloat(match[1]) * 1000) + 500;
  }
  return 0;
};

const callGroqWithFallback = async <T>(
  apiFn: (model: string) => Promise<T>,
): Promise<T> => {
  let lastErr: unknown = null;
  const modelsToTry = Array.from(new Set(FALLBACK_MODELS.filter(Boolean)));
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i]!;
    try {
      return await apiFn(model);
    } catch (err) {
      lastErr = err;
      if (i < modelsToTry.length - 1) {
        const parsedMs = extractRetryDelayMs(err);
        const isTransient = isTransientLlmError(err);
        const waitMs = parsedMs > 0 ? parsedMs : isTransient ? Math.min(1000 * Math.pow(2, i), 4000) : 300;
        await delay(waitMs);
      }
    }
  }
  throw lastErr;
};


const toToolCalls = (
  rawCalls: readonly Groq.Chat.Completions.ChatCompletionMessageToolCall[],
): readonly ToolCall[] =>
  rawCalls.map((call) => ({
    callId: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));

const stripThinkingTags = (content: string): string => {
  const stripped = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<function=[\w]+>[\s\S]*?<\/function>/gi, "")
    .replace(/<parameter=[\w]+>[\s\S]*?<\/parameter>/gi, "")
    .replace(/<tools>[\s\S]*?<\/tools>/gi, "")
    .replace(/\[?TOOL_CALL[\s\S]*?END_TOOL_CALL\]?/gi, "")
    .trim();

  if (stripped.length > 0) return stripped;

  // Fallback: If the model placed response inside <think>, extract the text rather than returning empty
  const thinkMatch = /<think>([\s\S]*?)<\/think>/i.exec(content);
  if (thinkMatch && thinkMatch[1]?.trim()) {
    return thinkMatch[1]
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
      .trim();
  }

  // Fallback 2: strip angle bracket tags
  const bracketCleaned = content.replace(/<[^>]+>/g, "").trim();
  return bracketCleaned.length > 0 ? bracketCleaned : content.trim();
};

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
  if (process.env.NODE_ENV === "test" || env.nodeEnv === "test") {
    return mockProvider.generate({ instructions, input });
  }
  try {
    return await callGroqWithFallback(async (selectedModel) => {
      const response = await client.chat.completions.create({
        model: selectedModel,
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
    });
  } catch (error) {
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
  return callGroqWithFallback(async (selectedModel) => {
    try {
      const response = await client.chat.completions.create({
        model: selectedModel,
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
            model: selectedModel,
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
  });
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
  return callGroqWithFallback(async (selectedModel) => {
    try {
      const response = await client.chat.completions.create({
        model: selectedModel,
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
            model: selectedModel,
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
  });
};
