export interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly mode?: "code" | "document" | "mixed" | "general" | "system" | undefined;
}

export interface Memory {
  get(tenantId: string, sessionId: string): readonly Message[];
  add(
    tenantId: string,
    sessionId: string,
    message: Message
  ): void;
  clear(tenantId: string, sessionId: string): void;
}

const DEFAULT_MAX_MESSAGES = 20;

export class ConversationMemory implements Memory {
  private readonly conversations = new Map<string, Message[]>();

  constructor(
    private readonly maxMessages = DEFAULT_MAX_MESSAGES
  ) {}

  private key(tenantId: string, sessionId: string): string {
    return `${tenantId}:${sessionId}`;
  }

  get(
    tenantId: string,
    sessionId: string
  ): readonly Message[] {
    return this.conversations.get(this.key(tenantId, sessionId)) ?? [];
  }

  add(
    tenantId: string,
    sessionId: string,
    message: Message
  ): void {
    const key = this.key(tenantId, sessionId);
    const messages = this.conversations.get(key) ?? [];

    messages.push(message);

    if (messages.length > this.maxMessages) {
      messages.splice(0, messages.length - this.maxMessages);
    }

    this.conversations.set(key, messages);
  }

  clear(tenantId: string, sessionId: string): void {
    this.conversations.delete(this.key(tenantId, sessionId));
  }
}
