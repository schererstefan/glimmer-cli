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
    include: ["tests/**/*.test.ts"],
    reporters: process.env.CI ? ["default"] : ["default"],
    coverage: {
      include: ["src/**/*.ts"],
    },
  },
});
