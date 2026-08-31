import "dotenv/config";

const getRequiredEnv = (name: string): string => {
  const value = process.env[name]?.trim();

  if (!value) {
    if ((process.env.NODE_ENV?.trim() || "development") !== "production") {
      return "gsk_dummy_test_key_for_unit_tests";
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const getPort = (): number => {
  const port = Number(process.env.PORT ?? "3000");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV?.trim() || "development",
  port: getPort(),
  groqApiKey: getRequiredEnv("GROQ_API_KEY"),
  groqModel: process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b",
  maxRagContextTokens: Number(process.env.MAX_RAG_CONTEXT_TOKENS ?? "1200"),
  maxMemoryTokens: Number(process.env.MAX_MEMORY_TOKENS ?? "300"),
  maxRetrievedChunks: Number(process.env.MAX_RETRIEVED_CHUNKS ?? "4"),
  ragDebugContext: process.env.RAG_DEBUG_CONTEXT === "true",
});
