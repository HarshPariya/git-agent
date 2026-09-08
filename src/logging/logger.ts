import type { LogContext, LogLevel, StructuredLogger } from "../types/logging.js";

export type { LogContext, LogLevel, StructuredLogger };

const log = (level: LogLevel, message: string, context: LogContext = {}): void => {
  void process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...context })}\n`);
};

export const logger = Object.freeze({
  info: (message: string, context?: LogContext): void => log("info", message, context),
  warn: (message: string, context?: LogContext): void => log("warn", message, context),
  error: (message: string, context?: LogContext): void => log("error", message, context),
});
