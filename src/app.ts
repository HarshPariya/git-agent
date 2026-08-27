import cors from "cors";
import express from "express";

import { chatHandler } from "./api/chat.js";
import { env } from "./config/env.js";
import { errorHandler } from "./errors/error-handler.js";
import { logger } from "./logging/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { securityMiddleware } from "./middleware/security.js";

export const app = express();

app.disable("x-powered-by");

app.use(cors());
app.use(requestIdMiddleware);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    environment: env.nodeEnv,
  });
});

app.post("/chat", securityMiddleware, chatHandler);

app.use(errorHandler);

export const startServer = (): void => {
  app.listen(env.port, () => {
    logger.info("AI chatbot API started", {
      operation: "startup",
      metadata: {
        port: env.port,
        environment: env.nodeEnv,
      },
    });
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
