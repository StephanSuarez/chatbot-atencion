// Valida las variables de entorno obligatorias. Se llama al iniciar el servidor (instrumentation.ts).

export function readEncryptionKey(value: string | undefined): Buffer {
  const key = Buffer.from(value ?? "", "base64");
  // Buffer.from ignora caracteres inválidos: la ida y vuelta exige base64 canónico.
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error(
      "ENCRYPTION_KEY falta o es inválida: debe ser 32 bytes en base64 (openssl rand -base64 32)",
    );
  }
  return key;
}

export function checkEnv(env: Record<string, string | undefined> = process.env): void {
  if (!env.DATABASE_URL) throw new Error("Falta DATABASE_URL");
  readEncryptionKey(env.ENCRYPTION_KEY);
}
