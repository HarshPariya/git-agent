import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LocalAgentConfig } from "./types.js";

const DEFAULT_PORT = 41732;
const DEFAULT_HOST = "127.0.0.1";

export function getDefaultConfig(): LocalAgentConfig {
  const customPort = process.env.LOCAL_AGENT_PORT ? parseInt(process.env.LOCAL_AGENT_PORT, 10) : DEFAULT_PORT;
  const agentHome = path.join(os.homedir(), ".git-agent");
  const tokenFilePath = path.join(agentHome, "local-agent-token.json");

  return {
    host: DEFAULT_HOST,
    port: Number.isNaN(customPort) ? DEFAULT_PORT : customPort,
    allowedOrigins: [
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "https://git-agent.vercel.app",
      "null",
    ],
    tokenExpiryHours: 24 * 7,
    tokenFilePath,
  };
}

export interface StoredTokenData {
  token: string;
  createdAt: string;
}

export async function getOrGeneratePairingToken(tokenFilePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(tokenFilePath, "utf-8");
    const data = JSON.parse(raw) as StoredTokenData;
    if (typeof data?.token === "string" && data.token.length >= 32) {
      return data.token;
    }
  } catch {
    // File doesn't exist or is invalid — generate fresh token
  }

  const token = crypto.randomBytes(32).toString("hex");
  const dir = path.dirname(tokenFilePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tokenFilePath, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });

  return token;
}
