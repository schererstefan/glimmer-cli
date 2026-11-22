import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    include: ["tests/**/*.test.ts"],
    reporters: process.env.CI ? ["default"] : ["default"],
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      thresholds: {
        lines: 55,
        functions: 60,
        branches: 45,
        statements: 50,
      },
    },
  },
});
