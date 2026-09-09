import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exclude custom test runners that use tsx (not vitest-compatible)
    exclude: [
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "tests/run-all.ts",
      "node_modules/**",
      "dist/**",
    ],
    // Include only vitest-compatible test files
    include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
    environment: "node",
  },
});
