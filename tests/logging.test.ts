import test from "node:test";
import assert from "node:assert/strict";

import { logger } from "../src/logging/logger.js";

test("exposes structured logging methods", () => {
  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.warn, "function");
  assert.equal(typeof logger.error, "function");
});
