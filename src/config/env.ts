import "dotenv/config";

const PORT_MIN = 1;
const PORT_MAX = 65535;
const DEFAULT_PORT = 3000;
const TEST_MOCK_KEY = "mock-key-for-test";

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  const isProduction = process.env.NODE_ENV === "production";
  if (!value && process.env.NODE_ENV !== "test" && isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value || TEST_MOCK_KEY;
};

const getPort = (): number => {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
};

export const env = Object.freeze({
  get nodeEnv(): string {
    return process.env.NODE_ENV?.trim() || "development";
  },
  port: getPort(),
  groqApiKey: getRequiredEnv("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL?.trim() || "groq/compound",
  maxRagContextTokens: Number(process.env.MAX_RAG_CONTEXT_TOKENS ?? 1200),
  maxMemoryTokens: Number(process.env.MAX_MEMORY_TOKENS ?? 300),
  maxRetrievedChunks: Number(process.env.MAX_RETRIEVED_CHUNKS ?? 4),
  ragDebugContext: process.env.RAG_DEBUG_CONTEXT === "true",
  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || "",
  n8nApiKey: process.env.N8N_API_KEY?.trim() || "",
  n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET?.trim() || "",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL?.trim() || "",
});
