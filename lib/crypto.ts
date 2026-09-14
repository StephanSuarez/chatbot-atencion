import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Cifrado de la API key en reposo con AES-256-GCM (plan §7).
// Formato guardado: iv.tag.cifrado, cada parte en base64. La clave maestra sale de readEncryptionKey (lib/env.ts).

const ALGORITHM = "aes-256-gcm";
const TAG_LENGTH = 16;

export function encryptApiKey(apiKey: string, masterKey: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_LENGTH });
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

// Devuelve null si no se puede descifrar (clave maestra distinta o dato alterado):
// la configuración pasa a "incompleta" y hay que volver a ingresar la key (plan §8).
export function decryptApiKey(stored: string, masterKey: Buffer): string | null {
  try {
    const [iv, tag, ciphertext] = stored.split(".").map((part) => Buffer.from(part, "base64"));
    // authTagLength fijo: sin él, Node acepta tags truncados y el dato se podría falsificar.
    const decipher = createDecipheriv(ALGORITHM, masterKey, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const lastFour = (apiKey: string) => apiKey.slice(-4);

export const maskApiKey = (last4: string) => `…${last4}`;
