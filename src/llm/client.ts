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

type Response = Groq.Chat.Completions.ChatCompletion;
type Message = Groq.Chat.Completions.ChatCompletionMessage;

export type { LlmTool, LlmResponse, ToolLlmResponse };

export interface LlmMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

const MAX_COMPLETION_TOKENS = 4096;
const client = new Groq({ apiKey: env.groqApiKey });

const FALLBACK_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  env.groqModel,
];

const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const TRANSIENT_NAMES = new Set(["APIConnectionError", "APIConnectionTimeoutError"]);
const TRANSIENT_SUBSTRINGS = ["Connection error", "ETIMEDOUT", "ECONNRESET", "rate_limit"];

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const isTransientLlmError = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;

  const e = err as Record<string, unknown>;
  const status = Number(e.status ?? (e as { error?: { status?: number } }).error?.status);
  const msg = String(e.message || e.error || "");
  const name = String(e.name || "");

  return (
    TRANSIENT_STATUSES.has(status) ||
    TRANSIENT_NAMES.has(name) ||
    TRANSIENT_SUBSTRINGS.some((s) => msg.includes(s))
  );
};

const extractRetryDelayMs = (err: unknown): number => {
  const match = /try again in (\d+(?:\.\d+)?)s/i.exec(String(err));
  return match?.[1] ? Math.ceil(parseFloat(match[1]) * 1000) + 500 : 0;
};

const callGroqWithFallback = async <T>(apiFn: (model: string) => Promise<T>): Promise<T> => {
  const modelsToTry = Array.from(new Set(FALLBACK_MODELS.filter(Boolean)));
  let lastErr: unknown = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i]!;
    try {
      return await apiFn(model);
    } catch (err) {
      lastErr = err;
      if (i < modelsToTry.length - 1) {
        const parsedMs = extractRetryDelayMs(err);
        const waitMs = parsedMs > 0
          ? parsedMs
          : isTransientLlmError(err)
            ? Math.min(1000 * 2 ** i, 4000)
            : 300;
        await delay(waitMs);
      }
    }
  }

  throw lastErr;
};

const toToolCalls = (rawCalls: readonly Groq.Chat.Completions.ChatCompletionMessageToolCall[]): ToolCall[] =>
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

  if (stripped) return stripped;

  const thinkMatch = /<think>([\s\S]*?)<\/think>/i.exec(content);
  if (thinkMatch?.[1]?.trim()) return thinkMatch[1].replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim();

  const bracketCleaned = content.replace(/<[^>]+>/g, "").trim();
  return bracketCleaned || content.trim();
};

const parseXmlToolCalls = (content: string): { toolCalls: ToolCall[]; cleanContent: string } => {
  const toolCalls: ToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw) as { name?: string; arguments?: Record<string, unknown> | string };
      if (parsed.name) {
        toolCalls.push({
          callId: `call_${crypto.randomUUID().slice(0, 8)}`,
          name: parsed.name,
          arguments: typeof parsed.arguments === "object"
            ? JSON.stringify(parsed.arguments)
            : String(parsed.arguments ?? "{}"),
        });
      }
    } catch { /* Ignored malformed XML chunk */ }
  }

  return {
    toolCalls,
    cleanContent: content.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "").trim(),
  };
};

const extractFailedGeneration = (err: unknown): string | null => {
  if (typeof err === "object" && err !== null) {
    const failedGen = (err as Record<string, unknown>).error as Record<string, unknown> | undefined;
    if (typeof failedGen?.failed_generation === "string") return failedGen.failed_generation;
  }

  const match = /"failed_generation":\s*"([\s\S]*?)"\s*[,}]/.exec(String(err));
  if (!match?.[1]) return null;

  try { return JSON.parse(`"${match[1]}"`); } catch { return match[1]; }
};

const recoverToolCallsFromFailedGeneration = (
  failedGen: string,
): { toolCalls: ToolCall[]; cleanContent: string } => {
  if (failedGen.includes("<tool_call>")) return parseXmlToolCalls(failedGen);

  try {
    const parsed = JSON.parse(failedGen.trim()) as { name?: string; arguments?: Record<string, unknown> | string };
    if (typeof parsed?.name !== "string") return { toolCalls: [], cleanContent: "" };

    return {
      toolCalls: [{
        callId: `call_${crypto.randomUUID().slice(0, 8)}`,
        name: parsed.name,
        arguments: typeof parsed.arguments === "object"
          ? JSON.stringify(parsed.arguments)
          : String(parsed.arguments ?? "{}"),
      }],
      cleanContent: "",
    };
  } catch {
    const nameMatch = /"name":\s*"([^"]+)"/.exec(failedGen);
    if (!nameMatch?.[1]) return { toolCalls: [], cleanContent: "" };

    const argsMatch = /"arguments":\s*({[\s\S]*})/.exec(failedGen);
    return {
      toolCalls: [{
        callId: `call_${crypto.randomUUID().slice(0, 8)}`,
        name: nameMatch[1],
        arguments: argsMatch?.[1] ?? "{}",
      }],
      cleanContent: "",
    };
  }
};

const extractToolCallsFromResponse = (message: Message | undefined, rawContent: string) => {
  const toolCalls: ToolCall[] = message?.tool_calls ? toToolCalls(message.tool_calls) : [];
  if (toolCalls.length > 0) return { toolCalls, text: rawContent.trim() };

  if (!rawContent.includes("<tool_call>")) return { toolCalls, text: rawContent.trim() };

  const parsed = parseXmlToolCalls(rawContent);
  return parsed.toolCalls.length > 0
    ? { toolCalls: parsed.toolCalls, text: parsed.cleanContent }
    : { toolCalls, text: rawContent.trim() };
};

const buildToolResponse = (
  response: Response,
  toolCalls: readonly ToolCall[],
  text: string,
  message?: Message,
): ToolLlmResponse => ({
  id: response.id,
  model: response.model,
  text,
  toolCalls,
  message: {
    role: "assistant",
    content: message?.content ?? null,
    ...(message?.tool_calls !== undefined && { tool_calls: message.tool_calls }),
  },
});

const buildRecoveredResponse = (_model: string, parsed: { toolCalls: ToolCall[]; cleanContent: string }): ToolLlmResponse => ({
  id: `recovered-${crypto.randomUUID()}`,
  model: _model,
  text: parsed.cleanContent,
  toolCalls: parsed.toolCalls,
  message: {
    role: "assistant",
    content: parsed.cleanContent || null,
    tool_calls: parsed.toolCalls.map((tc) => ({
      id: tc.callId,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  },
});

const handleToolCallResponse = async (
  messages: readonly Groq.Chat.Completions.ChatCompletionMessageParam[],
  tools: readonly LlmTool[],
): Promise<ToolLlmResponse> =>
  callGroqWithFallback(async (selectedModel) => {
    try {
      const response = await client.chat.completions.create({
        model: selectedModel,
        max_tokens: MAX_COMPLETION_TOKENS,
        messages: [...messages],
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
          },
        })),
        tool_choice: "auto",
      });

      const message = response.choices[0]?.message;
      const rawContent = stripThinkingTags(message?.content ?? "");
      const { toolCalls, text } = extractToolCallsFromResponse(message, rawContent);

      return buildToolResponse(response, toolCalls, text, message);
    } catch (err) {
      const failedGen = extractFailedGeneration(err);
      if (failedGen) {
        const parsed = recoverToolCallsFromFailedGeneration(failedGen);
        if (parsed.toolCalls.length > 0) return buildRecoveredResponse(selectedModel, parsed);
      }
      throw err;
    }
  });

export const generateText = async ({ instructions, input }: LlmRequest): Promise<LlmResponse> => {
  if (process.env.NODE_ENV === "test" || env.nodeEnv === "test") {
    return mockProvider.generate({ instructions, input });
  }

  try {
    return await callGroqWithFallback(async (selectedModel) => {
      const response = await client.chat.completions.create({
        model: selectedModel,
        max_tokens: MAX_COMPLETION_TOKENS,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
      });

      const text = stripThinkingTags(response.choices[0]?.message.content?.trim() ?? "");
      if (!text) throw new Error("LLM returned an empty response");

      return { id: response.id, model: response.model, text };
    });
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("Groq text generation failed");
  }
};

export const groqProvider: LlmProvider = { generate: generateText };

export const isLlmAvailable = async (): Promise<boolean> => Boolean(env.groqApiKey);

export const callLlm = async (
  messages: readonly LlmMessage[],
  options: { readonly maxTokens?: number; readonly temperature?: number } = {},
): Promise<LlmResponse & { readonly content: string }> => {
  void options;
  const system = messages.find((m) => m.role === "system");
  const user = messages.find((m) => m.role === "user");
  const response = await generateText({
    instructions: system?.content ?? "",
    input: user?.content ?? "",
  });

  return { ...response, content: response.text };
};

export const generateWithTools = async ({
  instructions,
  input,
  tools,
}: {
  readonly instructions: string;
  readonly input: string;
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> =>
  handleToolCallResponse(
    [
      { role: "system", content: instructions },
      { role: "user", content: input },
    ],
    tools,
  );

export const continueWithTools = async ({
  instructions,
  messages,
  tools,
}: {
  readonly instructions: string;
  readonly messages: readonly Groq.Chat.Completions.ChatCompletionMessageParam[];
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> =>
  handleToolCallResponse(
    [{ role: "system", content: instructions }, ...messages],
    tools,
  );
