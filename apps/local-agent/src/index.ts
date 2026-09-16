/* eslint-disable no-console */
import { getDefaultConfig } from "./config.js";
import { createLocalAgentServer } from "./server.js";

async function main() {
  const config = getDefaultConfig();
  const agent = createLocalAgentServer(config);

  try {
    const { port, token } = await agent.start();

    console.log("===============================================================");
    console.log(" 🚀 Git Desktop - Local Companion Agent");
    console.log("===============================================================");
    console.log(` Status:       ACTIVE`);
    console.log(` Endpoint:     http://${config.host}:${port}`);
    console.log(` Security:     Loopback-only (127.0.0.1)`);
    console.log(` Token Store:  ${config.tokenFilePath}`);
    console.log("---------------------------------------------------------------");
    console.log(` 🔑 Pairing Token:`);
    console.log(`    ${token}`);
    console.log("---------------------------------------------------------------");
    console.log(" Instructions: Paste this token into your Git Desktop web UI");
    console.log("               under 'Pair Local Agent' to securely connect.");
    console.log(" Press Ctrl+C to stop companion agent.");
    console.log("===============================================================");

    const shutdown = async () => {
      console.log("\n🛑 Stopping Git Desktop Local Companion Agent...");
      await agent.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => {
      void shutdown();
    });
    process.on("SIGTERM", () => {
      void shutdown();
    });
  } catch (err: unknown) {
    console.error("❌ Failed to start Local Companion Agent:", err);
    process.exit(1);
  }
}

void main();
