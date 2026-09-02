import type { Request, Response } from "express";
import { env } from "../config/env.js";

export const healthHandler = (_request: Request, response: Response): void => {
  const uptimeSec = Math.floor(process.uptime());
  const uptimeMin = Math.floor(uptimeSec / 60);
  const uptimeStr =
    uptimeSec < 60
      ? `${uptimeSec}s`
      : `${uptimeMin}m ${uptimeSec % 60}s`;

  response.status(200).json({
    status: "ok",
    environment: env.nodeEnv,
    uptime: uptimeStr,
    uptimeSeconds: uptimeSec,
    version: "2.0.0",
    agent: "member2",
  });
};
