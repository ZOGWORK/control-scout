import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "server/**/*.test.ts", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "node",
    environmentMatchGlobs: [["src/**", "jsdom"]],
    testTimeout: 20000,
  },
});
