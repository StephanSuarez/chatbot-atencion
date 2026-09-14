import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env.local");
} catch {}

// Los tests usan una base aparte (<nombre>_test) para no borrar los datos de desarrollo.
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  url.pathname += "_test";
  process.env.DATABASE_URL = url.href;
}

export default defineConfig({
  test: { environment: "node", globalSetup: "./vitest.setup.ts" },
});
