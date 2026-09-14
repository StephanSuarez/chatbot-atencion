import { describe, expect, it } from "vitest";
import { checkEnv, readEncryptionKey } from "./env";

const validKey = Buffer.alloc(32, 7).toString("base64");

describe("readEncryptionKey", () => {
  it("acepta 32 bytes en base64", () => {
    expect(readEncryptionKey(validKey)).toHaveLength(32);
  });

  it.each([
    ["ausente", undefined],
    ["vacía", ""],
    ["corta", Buffer.alloc(16).toString("base64")],
    ["larga", Buffer.alloc(48).toString("base64")],
    ["no base64", "x".repeat(44)],
    ["con basura", validKey + "!"],
  ])("rechaza una key %s", (_, value) => {
    expect(() => readEncryptionKey(value)).toThrow(/ENCRYPTION_KEY/);
  });
});

describe("checkEnv", () => {
  it("exige DATABASE_URL", () => {
    expect(() => checkEnv({ ENCRYPTION_KEY: validKey })).toThrow(/DATABASE_URL/);
  });

  it("pasa con ambas variables válidas", () => {
    expect(() => checkEnv({ DATABASE_URL: "postgres://x", ENCRYPTION_KEY: validKey })).not.toThrow();
  });
});
