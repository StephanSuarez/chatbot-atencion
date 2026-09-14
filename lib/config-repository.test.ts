// Integración contra la base de tests (ver vitest.setup.ts).
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { readConfig, saveConfig, type ConfigValues } from "./config-repository";
import { sql } from "./db";

const base: ConfigValues = {
  companyName: "Acme",
  prompt: "Eres el asistente de Acme.",
  provider: "openai",
  model: "gpt-4o-mini",
  apiKeyEncrypted: "iv.tag.ct",
  apiKeyLast4: "abcd",
};

beforeEach(() => sql`delete from chatbot_config`);
afterAll(() => sql.end());

describe("repositorio de configuración", () => {
  it("sin configuración guardada devuelve null", async () => {
    expect(await readConfig()).toBeNull();
  });

  it("guarda y lee la configuración", async () => {
    await saveConfig(base);
    expect(await readConfig()).toMatchObject(base);
  });

  it("guardar de nuevo reemplaza la fila completa", async () => {
    await saveConfig(base);
    await saveConfig({ ...base, companyName: "Otra", provider: null, model: null, apiKeyEncrypted: null, apiKeyLast4: null });

    expect(await readConfig()).toMatchObject({ companyName: "Otra", provider: null, apiKeyEncrypted: null });
    const [{ count }] = await sql`select count(*)::int as count from chatbot_config`;
    expect(count).toBe(1);
  });

  it("la base rechaza una segunda fila", async () => {
    await saveConfig(base);
    await expect(sql`insert into chatbot_config (id, company_name, prompt) values (false, 'x', 'y')`).rejects.toThrow(
      /chatbot_config_single_row/,
    );
    await expect(sql`insert into chatbot_config (id, company_name, prompt) values (true, 'x', 'y')`).rejects.toThrow(
      /duplicate key/,
    );
  });
});
