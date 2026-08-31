import type { Message } from "../types/agent.js";
import type { MemoryStore } from "../types/services.js";

export type { MemoryStore };

export class InMemoryStore implements MemoryStore {
  private readonly sessions = new Map<string, Message[]>();

  private key(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  async get(
    tenantId: string,
    sessionId: string,
  ): Promise<readonly Message[]> {
    return this.sessions.get(this.key(tenantId, sessionId)) ?? [];
  }

  async add(
    tenantId: string,
    sessionId: string,
    message: Message,
  ): Promise<void> {
    const key = this.key(tenantId, sessionId);
    const messages = this.sessions.get(key) ?? [];

    messages.push(message);
    this.sessions.set(key, messages);
  }

  async clear(
    tenantId: string,
    sessionId: string,
  ): Promise<void> {
    this.sessions.delete(this.key(tenantId, sessionId));
  }
}