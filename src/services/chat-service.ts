import type { AgentContext, AgentExecutionResult } from "../types/agent.js";
import { createAgent } from "../agent/orchestrator.js";
import { ConversationMemory } from "../agent/memory.js";
import { groqProvider } from "../llm/client.js";
import { MockRetriever } from "../retrieval/mock-retriever.js";
import type { Retriever } from "../retrieval/types.js";
import type { LlmProvider } from "../types/llm.js";

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
    return this.agent.run(context);
  }
}
