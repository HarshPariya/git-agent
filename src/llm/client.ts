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
    const response = await client.chat.completions.create({
      model: env.groqModel,
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

    !text &&
      (() => {
        throw new Error("LLM returned an empty response");
      })();

    return {
      id: response.id,
      model: response.model,
      text,
    };
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
  const response = await client.chat.completions.create({
    model: env.groqModel,
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

  !message &&
    (() => {
      throw new Error("LLM returned no message");
    })();

  return {
    id: response.id,
    model: response.model,
    text: message?.content?.trim() ?? "",
    toolCalls: toToolCalls(message?.tool_calls ?? []),
    message: message!,
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
  const response = await client.chat.completions.create({
    model: env.groqModel,
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

  !message &&
    (() => {
      throw new Error("LLM returned no message");
    })();

  return {
    id: response.id,
    model: response.model,
    text: message?.content?.trim() ?? "",
    toolCalls: toToolCalls(message?.tool_calls ?? []),
    message: message!,
  };
};
