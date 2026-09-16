import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigRow, ConfigValues } from "./config-repository";
import { ProviderError } from "./providers/http";

// Repositorio en memoria y proveedor falso: aquí se prueban las reglas, no la base ni la red.
const store = vi.hoisted(() => ({ row: null as ConfigRow | null }));
// Lo de Google y el horario de atención no los toca guardar la configuración (006): van en null.
const sinGoogle = {
  googleRefreshTokenEncrypted: null,
  googleEmail: null,
  googleCalendarId: null,
  agendaDays: null,
  agendaStart: null,
  agendaEnd: null,
  agendaSlotMinutes: null,
  agendaMinNoticeHours: null,
} as const;
vi.mock("./config-repository", () => ({
  readConfig: async () => store.row,
  saveConfig: async (values: ConfigValues) =>
    (store.row = { id: true, updatedAt: new Date(), ...sinGoogle, ...values }),
}));

const fake = vi.hoisted(() => ({
  id: "fake",
  name: "Fake",
  verifyKey: vi.fn<(key: string) => Promise<void>>(),
  listChatModels: vi.fn<(key: string) => Promise<string[]>>(),
}));
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  getProvider: (id: string) => (id === "fake" || id === "otro" ? { ...fake, id } : undefined),
}));

const { DEFAULT_PROMPT, MAX_PROMPT, getConfig, loadModels, saveConfig } = await import("./config-service");

const KEY = "  sk-nueva-1234  ";
const valid = { companyName: "Acme", prompt: "Hola", provider: "fake", model: "m1", apiKey: KEY };

beforeEach(() => {
  store.row = null;
  vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  fake.verifyKey.mockReset().mockResolvedValue(undefined);
  fake.listChatModels.mockReset().mockResolvedValue(["m1", "m2"]);
});

describe("lectura", () => {
  it("primera vez: nombre vacío, prompt por defecto, sin LLM, incompleta", async () => {
    expect(await getConfig()).toEqual({
      companyName: "",
      prompt: DEFAULT_PROMPT,
      provider: null,
      model: null,
      apiKeyMask: null,
      complete: false,
      missing: ["el nombre", "el proveedor", "el modelo", "la API key"],
    });
  });

  it("completa tras guardar todo; la vista pública solo enmascara la key (SC-002)", async () => {
    await saveConfig(valid);
    const config = await getConfig();
    expect(config).toMatchObject({ complete: true, missing: [], apiKeyMask: "…1234" });
    expect(JSON.stringify(config)).not.toContain("sk-nueva");
    expect(store.row!.apiKeyEncrypted).not.toContain("sk-nueva");
  });

  it("si ENCRYPTION_KEY cambió, pide volver a ingresar la key", async () => {
    await saveConfig(valid);
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(await getConfig()).toMatchObject({ complete: false, apiKeyMask: null, missing: ["volver a ingresar la API key"] });
  });
});

describe("validación (FR-010: si algo es inválido no se guarda nada)", () => {
  it.each(["", "   "])("rechaza el nombre %j (SC-003)", async (companyName) => {
    const result = await saveConfig({ ...valid, companyName });
    expect(result).toEqual({ ok: false, errors: { companyName: expect.any(String) } });
    expect(store.row).toBeNull();
  });

  it("rechaza el prompt vacío y el que supera el máximo (FR-015)", async () => {
    expect(await saveConfig({ ...valid, prompt: "  " })).toMatchObject({ ok: false, errors: { prompt: expect.any(String) } });
    expect(await saveConfig({ ...valid, prompt: "x".repeat(MAX_PROMPT + 1) })).toMatchObject({ ok: false });
    expect((await saveConfig({ ...valid, prompt: "x".repeat(MAX_PROMPT) })).ok).toBe(true);
  });

  it("rechaza un proveedor fuera del registro", async () => {
    expect(await saveConfig({ ...valid, provider: "nope" })).toMatchObject({ ok: false, errors: { provider: expect.any(String) } });
  });

  it("rechaza un modelo que el proveedor no ofrece", async () => {
    expect(await saveConfig({ ...valid, model: "inventado" })).toMatchObject({ ok: false, errors: { model: expect.any(String) } });
    expect(store.row).toBeNull();
  });

  it("reporta todos los campos inválidos a la vez y no llama al proveedor", async () => {
    const result = await saveConfig({ ...valid, companyName: "", prompt: "", apiKey: "" });
    expect(result).toMatchObject({ ok: false, errors: { companyName: expect.any(String), prompt: expect.any(String) } });
    expect(fake.verifyKey).not.toHaveBeenCalled();
  });

  it("se puede guardar solo nombre y prompt (queda incompleta)", async () => {
    const result = await saveConfig({ ...valid, provider: "", model: "", apiKey: "" });
    expect(result).toMatchObject({ ok: true, config: { complete: false, missing: ["el proveedor", "el modelo", "la API key"] } });
  });
});

describe("API key", () => {
  it("quita espacios y verifica la key nueva al guardar", async () => {
    await saveConfig(valid);
    expect(fake.verifyKey).toHaveBeenCalledWith("sk-nueva-1234");
    expect(store.row!.apiKeyLast4).toBe("1234");
  });

  it.each([
    ["invalid_key", "apiKey"],
    ["unavailable", "form"],
  ] as const)("verificación %s → no guarda nada (SC-006)", async (kind, field) => {
    fake.verifyKey.mockRejectedValue(new ProviderError("fake", kind));
    expect(await saveConfig(valid)).toEqual({ ok: false, errors: { [field]: expect.any(String) } });
    expect(store.row).toBeNull();
  });

  it("guardar sin tocar la key la conserva y no llama al proveedor (FR-008)", async () => {
    await saveConfig(valid);
    const encrypted = store.row!.apiKeyEncrypted;
    fake.verifyKey.mockClear();
    fake.listChatModels.mockClear();

    expect(await saveConfig({ ...valid, companyName: "Otra", apiKey: "" })).toMatchObject({ ok: true });
    expect(store.row).toMatchObject({ companyName: "Otra", apiKeyEncrypted: encrypted });
    expect(fake.verifyKey).not.toHaveBeenCalled();
    expect(fake.listChatModels).not.toHaveBeenCalled();
  });

  it("cambiar de modelo sin key nueva valida el modelo con la key guardada", async () => {
    await saveConfig(valid);
    expect(await saveConfig({ ...valid, model: "m2", apiKey: "" })).toMatchObject({ ok: true });
    expect(fake.listChatModels).toHaveBeenLastCalledWith("sk-nueva-1234");
  });

  it("una key nueva reemplaza a la anterior", async () => {
    await saveConfig(valid);
    await saveConfig({ ...valid, apiKey: "sk-otra-9999" });
    expect((await getConfig()).apiKeyMask).toBe("…9999");
  });

  it("cambiar de proveedor exige una key nueva (FR-009)", async () => {
    await saveConfig(valid);
    const before = store.row;
    expect(await saveConfig({ ...valid, provider: "otro", apiKey: "" })).toMatchObject({ ok: false, errors: { apiKey: expect.any(String) } });
    expect(store.row).toBe(before);
  });

  it("guardar dos veces igual da el mismo resultado", async () => {
    const first = await saveConfig(valid);
    const second = await saveConfig(valid);
    expect(second).toEqual(first);
  });
});

describe("cargar modelos", () => {
  it("con key nueva la verifica y lista", async () => {
    expect(await loadModels("fake", KEY)).toEqual({ ok: true, models: ["m1", "m2"] });
    expect(fake.verifyKey).toHaveBeenCalledWith("sk-nueva-1234");
  });

  it("sin key usa la guardada del mismo proveedor", async () => {
    await saveConfig(valid);
    fake.verifyKey.mockClear();
    expect(await loadModels("fake", "")).toMatchObject({ ok: true });
    expect(fake.verifyKey).not.toHaveBeenCalled();
    expect(fake.listChatModels).toHaveBeenLastCalledWith("sk-nueva-1234");
  });

  it("sin key y con otro proveedor pide la key", async () => {
    await saveConfig(valid);
    expect(await loadModels("otro", "")).toEqual({ ok: false, errors: { apiKey: expect.any(String) } });
  });

  it("traduce los errores del proveedor", async () => {
    fake.verifyKey.mockRejectedValue(new ProviderError("fake", "invalid_key"));
    expect(await loadModels("fake", KEY)).toEqual({ ok: false, errors: { apiKey: expect.any(String) } });
  });
});
