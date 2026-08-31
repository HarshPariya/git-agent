import Groq from "groq-sdk";

import { env } from "../config/env.js";
import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmTool,
  ToolCall,
  ToolLlmResponse,
} from "../types/llm.js";

export type { LlmTool, ToolCall, ToolLlmResponse };

const client = new Groq({
  apiKey: env.groqApiKey,
});

const MAX_COMPLETION_TOKENS = 4096;

const stripThinkingTags = (content: string): string =>
  content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

const toToolCalls = (
  calls: readonly Groq.Chat.Completions.ChatCompletionMessageToolCall[],
): readonly ToolCall[] =>
  calls.map((call) => ({
    callId: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));

const parseXmlToolCalls = (
  rawContent: string,
): { toolCalls: ToolCall[]; cleanContent: string } => {
  const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  const toolCalls: ToolCall[] = [];
  let match: RegExpExecArray | null;

  while ((match = toolCallRegex.exec(rawContent)) !== null) {
    const inner = match[1]?.trim() ?? "";
    if (inner.startsWith("{") && inner.endsWith("}")) {
      try {
        const parsed = JSON.parse(inner) as Record<string, unknown>;
        const name = String(parsed.name ?? parsed.function ?? "");
        const args =
          typeof parsed.arguments === "object"
            ? JSON.stringify(parsed.arguments)
            : String(parsed.arguments ?? parsed.parameters ?? "{}");
        if (name) {
          toolCalls.push({
            callId: `xml-${crypto.randomUUID()}`,
            name,
            arguments: args,
          });
        }
      } catch {
        // Fallback to XML regex parsing
      }
    } else {
      const funcMatch = /<function=([^>]+)>([\s\S]*?)<\/function>/i.exec(inner);
      if (funcMatch) {
        const name = funcMatch[1]?.trim() ?? "";
        const body = funcMatch[2] ?? "";
        const paramRegex = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/gi;
        const argsObj: Record<string, unknown> = {};
        let pMatch: RegExpExecArray | null;
        while ((pMatch = paramRegex.exec(body)) !== null) {
          const paramName = pMatch[1]?.trim();
          const paramValue = pMatch[2]?.trim();
          if (paramName) {
            argsObj[paramName] = paramValue;
          }
        }
        if (name) {
          toolCalls.push({
            callId: `xml-${crypto.randomUUID()}`,
            name,
            arguments: JSON.stringify(argsObj),
          });
        }
      }
    }
  }

  const cleanContent = rawContent
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .trim();
  return { toolCalls, cleanContent };
};

const extractFailedGeneration = (err: unknown): string | null => {
  if (typeof err === "object" && err !== null) {
    const errorObj = (err as Record<string, unknown>).error as Record<string, unknown> | undefined;
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

export const groqProvider: LlmProvider = {
  async generate({ instructions, input }: LlmRequest): Promise<LlmResponse> {
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
    } catch (err: unknown) {
      const errorMsg = String(err);
      if (
        errorMsg.includes("Tool choice is none") ||
        errorMsg.includes("tool_use_failed")
      ) {
        const fallback = await client.chat.completions.create({
          model: env.groqModel,
          max_tokens: MAX_COMPLETION_TOKENS,
          messages: [
            {
              role: "system",
              content: `${instructions}\n\nIMPORTANT: Respond only in natural markdown text without function or tool calling.`,
            },
            {
              role: "user",
              content: input,
            },
          ],
        });
        const fallbackRaw =
          fallback.choices[0]?.message.content?.trim() ?? "";
        const fallbackText = stripThinkingTags(fallbackRaw);
        if (fallbackText) {
          return {
            id: fallback.id,
            model: fallback.model,
            text: fallbackText,
          };
        }
      }
      throw err;
    }
  },
};

export const generateText = (request: LlmRequest): Promise<LlmResponse> =>
  groqProvider.generate(request);

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
    if (failedGen && failedGen.includes("<tool_call>")) {
      const parsed = parseXmlToolCalls(failedGen);
      if (parsed.toolCalls.length > 0) {
        return {
          id: `recovered-${crypto.randomUUID()}`,
          model: env.groqModel,
          text: parsed.cleanContent,
          toolCalls: parsed.toolCalls,
          message: {
            role: "assistant",
            content: parsed.cleanContent || null,
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
    if (failedGen && failedGen.includes("<tool_call>")) {
      const parsed = parseXmlToolCalls(failedGen);
      if (parsed.toolCalls.length > 0) {
        return {
          id: `recovered-${crypto.randomUUID()}`,
          model: env.groqModel,
          text: parsed.cleanContent,
          toolCalls: parsed.toolCalls,
          message: {
            role: "assistant",
            content: parsed.cleanContent || null,
          },
        };
      }
    }
    throw err;
  }
};
