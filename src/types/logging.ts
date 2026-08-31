export type LogLevel = "info" | "warn" | "error";

export interface LogContext {
  readonly requestId?: string;
  readonly operation?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface StructuredLogger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
