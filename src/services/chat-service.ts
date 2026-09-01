import type { AgentContext, AgentExecutionResult } from "../types/agent.js";
import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { groqProvider } from "../llm/client.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";
import type { Retriever } from "../retrieval/types.js";
import type { LlmProvider } from "../types/llm.js";
import { AppError } from "../errors/app-error.js";

export class ChatService {
  private readonly agent: ReturnType<typeof createAgent>;

  constructor(
    memory = new ConversationMemory(),
    retriever: Retriever = new MockRetriever(),
    llm: LlmProvider = groqProvider,
  ) {
    this.agent = createAgent(memory, retriever, llm);
  }

  async executeChat(context: AgentContext): Promise<AgentExecutionResult> {
    if (!context.tenantId || !context.question) {
      throw new AppError("Invalid agent context: tenantId and question required", "VALIDATION_ERROR", 400);
    }
    return this.agent.run(context);
  }
}
