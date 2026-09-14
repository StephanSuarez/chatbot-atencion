"use server";

import { loadModels, saveConfig, type ConfigInput, type ModelsResult, type SaveResult } from "../lib/config-service";

// Sin login (principio 11): cualquiera puede llamar estas acciones con un POST. Lo que llega no es confiable.
const str = (value: unknown) => (typeof value === "string" ? value : "");

// Solo se registra el mensaje: el error completo podría arrastrar parámetros de la consulta.
const logError = (what: string, e: unknown) => console.error(`[config] ${what}:`, e instanceof Error ? e.message : e);

export async function saveAction(input: ConfigInput): Promise<SaveResult> {
  try {
    return await saveConfig({
      companyName: str(input?.companyName),
      prompt: str(input?.prompt),
      provider: str(input?.provider),
      model: str(input?.model),
      apiKey: str(input?.apiKey),
    });
  } catch (e) {
    logError("no se pudo guardar", e);
    return { ok: false, errors: { form: "No pudimos guardar. Tus cambios siguen aquí; intenta de nuevo." } };
  }
}

export async function loadModelsAction(provider: string, apiKey: string): Promise<ModelsResult> {
  try {
    return await loadModels(str(provider), str(apiKey));
  } catch (e) {
    logError("no se pudieron cargar los modelos", e);
    return { ok: false, errors: { form: "No pudimos cargar los modelos. Intenta de nuevo." } };
  }
}
