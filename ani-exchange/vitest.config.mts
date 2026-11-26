import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Carga .env, .env.local, .env.test… (incluye TEST_DATABASE_URL).
    env: loadEnv("test", process.cwd(), ""),
    // Las pruebas de integración comparten la base de pruebas.
    fileParallelism: false,
  },
});
