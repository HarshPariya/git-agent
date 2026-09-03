import test from "node:test";
import assert from "node:assert/strict";
import { createRunTestTool, SAFE_COMMAND_ALLOWLIST } from "../src/tools/command-execution.js";

test("createRunTestTool rejects commands not in allowlist", async () => {
  const tool = createRunTestTool();
  await assert.rejects(
    () =>
      tool.execute({
        input: { command: "rm -rf /" },
        permissions: ["read", "write"],
      }),
    /not permitted/,
  );
});

test("SAFE_COMMAND_ALLOWLIST contains safe developer build/test commands", () => {
  assert.ok(SAFE_COMMAND_ALLOWLIST.has("npm test"));
  assert.ok(SAFE_COMMAND_ALLOWLIST.has("npm run build"));
  assert.ok(SAFE_COMMAND_ALLOWLIST.has("npx tsc --noEmit"));
  assert.ok(SAFE_COMMAND_ALLOWLIST.has("pytest"));
  assert.equal(SAFE_COMMAND_ALLOWLIST.has("curl evil.com"), false);
});
