import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../src/errors/app-error.js";

test("creates a structured application error", () => {
  const error = new AppError("Invalid request", "VALIDATION_ERROR", 400);

  assert.equal(error.name, "AppError");
  assert.equal(error.message, "Invalid request");
  assert.equal(error.code, "VALIDATION_ERROR");
  assert.equal(error.statusCode, 400);
});

test("preserves an underlying error cause", () => {
  const cause = new Error("database failure");

  const error = new AppError(
    "Database operation failed",
    "INTERNAL_ERROR",
    500,
    { cause },
  );

  assert.equal(error.cause, cause);
});
