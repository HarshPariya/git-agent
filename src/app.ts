import cors from "cors";
import express from "express";

import { chatHandler } from "./api/chat.js";
import { env } from "./config/env.js";
import { errorHandler } from "./errors/error-handler.js";
import { logger } from "./logging/logger.js";
import { requestIdMiddleware } from "./middleware/request-id.js";

const app = express();

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

app.post("/chat", chatHandler);

app.use(errorHandler);

app.listen(env.port, () => {
  logger.info("AI chatbot API started", {
    operation: "startup",
    metadata: {
      port: env.port,
      environment: env.nodeEnv,
    },
  });
});
