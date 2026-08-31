import type { Request, Response } from "express";
import { env } from "../config/env.js";

export const healthHandler = (_request: Request, response: Response): void => {
  response.status(200).json({
    status: "ok",
    environment: env.nodeEnv,
  });
};
