import { defineConfig } from "vitest/config";

// Los tests de integración usan la base local de .env.local (si no existe, se usa el entorno).
try {
  process.loadEnvFile(".env.local");
} catch {}

export default defineConfig({
  test: { environment: "node" },
});
