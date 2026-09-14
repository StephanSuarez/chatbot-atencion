import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, lastFour, maskApiKey } from "./crypto";

const masterKey = Buffer.alloc(32, 1);
const apiKey = "sk-proj-secreta-1234abcd";

describe("cifrado de la API key", () => {
  it("cifra y descifra de ida y vuelta", () => {
    expect(decryptApiKey(encryptApiKey(apiKey, masterKey), masterKey)).toBe(apiKey);
  });

  it("el dato guardado no contiene la key", () => {
    expect(encryptApiKey(apiKey, masterKey)).not.toContain("secreta");
  });

  it("cada cifrado es distinto aunque la key sea la misma", () => {
    expect(encryptApiKey(apiKey, masterKey)).not.toBe(encryptApiKey(apiKey, masterKey));
  });

  it("con otra clave maestra no se puede descifrar", () => {
    expect(decryptApiKey(encryptApiKey(apiKey, masterKey), Buffer.alloc(32, 2))).toBeNull();
  });

  it("un dato alterado no se descifra", () => {
    const [iv, tag, ct] = encryptApiKey(apiKey, masterKey).split(".");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(decryptApiKey([iv, tag, flipped.toString("base64")].join("."), masterKey)).toBeNull();
  });

  it("rechaza un tag truncado", () => {
    const [iv, tag, ct] = encryptApiKey(apiKey, masterKey).split(".");
    const short = Buffer.from(tag, "base64").subarray(0, 4).toString("base64");
    expect(decryptApiKey([iv, short, ct].join("."), masterKey)).toBeNull();
  });

  it.each(["", "basura", "a.b"])("un formato inválido (%j) no se descifra", (stored) => {
    expect(decryptApiKey(stored, masterKey)).toBeNull();
  });
});

describe("enmascarado", () => {
  it("muestra solo los últimos 4 caracteres", () => {
    expect(maskApiKey(lastFour(apiKey))).toBe("…abcd");
  });
});
