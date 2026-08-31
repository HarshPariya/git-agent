import "dotenv/config";

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  !value &&
    (() => {
      throw new Error(`Missing required environment variable: ${name}`);
    })();
  return value!;
};

const getPort = (): number => {
  const port = Number(process.env.PORT ?? "3000");
  (!Number.isInteger(port) || port < 1 || port > 65535) &&
    (() => {
      throw new Error("PORT must be an integer between 1 and 65535");
    })();
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
});
