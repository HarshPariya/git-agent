export type ErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "TOOL_ERROR"
  | "LLM_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly statusCode: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}
