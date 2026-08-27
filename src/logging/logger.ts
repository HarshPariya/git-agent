export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  readonly requestId?: string;
  readonly operation?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const log = (
  level: LogLevel,
  message: string,
  context: LogContext = {},
): void => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  process.stdout.write(`${JSON.stringify(entry)}\n`);
};

export const logger = Object.freeze({
  info: (message: string, context?: LogContext): void =>
    log("info", message, context),

  warn: (message: string, context?: LogContext): void =>
    log("warn", message, context),

  error: (message: string, context?: LogContext): void =>
    log("error", message, context),
});
