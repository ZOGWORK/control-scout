import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "server/**/*.test.ts", "bot/**/*.test.ts", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts", "deploy/**/*.test.ts"],
    environment: "node", // client tests opt into jsdom with a @vitest-environment docblock
    testTimeout: 20000,
  },
});
