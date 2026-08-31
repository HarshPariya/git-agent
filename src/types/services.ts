import type { Message } from "./agent.js";

export interface MemoryStore {
  get(tenantId: string, sessionId: string): Promise<readonly Message[]>;
  add(tenantId: string, sessionId: string, message: Message): Promise<void>;
  clear(tenantId: string, sessionId: string): Promise<void>;
}
