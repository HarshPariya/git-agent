import Groq from "groq-sdk";

import { env } from "../config/env.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./types.js";

export interface LlmTool {
  readonly type: "function";
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ToolCall {
  readonly callId: string;
  readonly name: string;
  readonly arguments: string;
}

export interface ToolLlmResponse extends LlmResponse {
  readonly toolCalls: readonly ToolCall[];
  readonly message: Groq.Chat.Completions.ChatCompletionMessage;
}

function getApiKey(): string {
  return process.env.GROQ_API_KEY?.trim() || env.groqApiKey || "";
}

function getGroqModel(): string {
  const model = process.env.GROQ_MODEL?.trim() || env.groqModel;
  if (!model || model.includes("llama")) {
    return "openai/gpt-oss-120b";
  }
  return model;
}

function getGroqClient(): Groq {
  return new Groq({
    apiKey: getApiKey(),
  });
}

const toToolCalls = (
  calls: readonly Groq.Chat.Completions.ChatCompletionMessageToolCall[],
): readonly ToolCall[] =>
  calls.map((call) => ({
    callId: call.id,
    name: call.function.name,
    arguments: call.function.arguments,
  }));

export const groqProvider: LlmProvider = {
  async generate({ instructions, input }: LlmRequest): Promise<LlmResponse> {
    const apiKey = getApiKey();
    if (
      !apiKey ||
      apiKey.includes("dummy") ||
      apiKey.includes("your_groq_api_key")
    ) {
      return {
        id: "local-demo-id",
        model: "local-demo",
        text: "Hello! How can I help you with your codebase today?\n\n*(Note: To get live AI answers from Groq, please update `GROQ_API_KEY` in your `.env` file).*",
      };
    }

    try {
      const client = getGroqClient();
      const response = await client.chat.completions.create({
        model: getGroqModel(),
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

      const text = response.choices[0]?.message.content?.trim() ?? "";

      if (!text) {
        throw new Error("LLM returned an empty response");
      }

      return {
        id: response.id,
        model: response.model,
        text,
      };
    } catch (err: any) {
      console.error("❌ Groq API call failed:", err?.message || err);
      return {
        id: "error-id",
        model: "error-fallback",
        text: `❌ **Groq API Error**: ${err?.message || "Failed to fetch response from Groq API"}. Please check your \`GROQ_API_KEY\` in \`.env\`.`,
      };
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
  const client = getGroqClient();
  const response = await client.chat.completions.create({
    model: getGroqModel(),
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
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    tool_choice: "auto",
  });

  const message = response.choices[0]?.message;

  if (!message) {
    throw new Error("LLM returned no message");
  }

  return {
    id: response.id,
    model: response.model,
    text: message.content?.trim() ?? "",
    toolCalls: toToolCalls(message.tool_calls ?? []),
    message,
  };
};

export const continueWithTools = async ({
  instructions,
  messages,
  tools,
}: {
  readonly instructions: string;
  readonly messages: Groq.Chat.Completions.ChatCompletionMessageParam[];
  readonly tools: readonly LlmTool[];
}): Promise<ToolLlmResponse> => {
  const client = getGroqClient();
  const response = await client.chat.completions.create({
    model: getGroqModel(),
    messages: [
      {
        role: "system",
        content: instructions,
      },
      ...messages,
    ],
    tools: tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
    tool_choice: "auto",
  });

  const message = response.choices[0]?.message;

  if (!message) {
    throw new Error("LLM returned no message");
  }

  return {
    id: response.id,
    model: response.model,
    text: message.content?.trim() ?? "",
    toolCalls: toToolCalls(message.tool_calls ?? []),
    message,
  };
};
