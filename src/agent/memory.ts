import type { Memory, Message } from "../types/agent.js";

export type { Memory, Message };

const DEFAULT_MAX_MESSAGES = 20;

export class ConversationMemory implements Memory {
  private readonly conversations = new Map<string, Message[]>();

  constructor(private readonly maxMessages = DEFAULT_MAX_MESSAGES) { }

  private key(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  get(tenantId: string, sessionId: string): readonly Message[] {
    return this.conversations.get(this.key(tenantId, sessionId)) ?? [];
  }

  add(tenantId: string, sessionId: string, message: Message): void {
    const key = this.key(tenantId, sessionId);
    const messages = this.conversations.get(key) ?? [];

    messages.push(message);
    const excess = messages.length - this.maxMessages;
    excess > 0 && messages.splice(0, excess);

    this.conversations.set(key, messages);
  }

  clear(tenantId: string, sessionId: string): void {
    this.conversations.delete(this.key(tenantId, sessionId));
  }
}