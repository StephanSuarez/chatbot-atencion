import { readConfig, saveConfig as saveRow, type ConfigRow } from "./config-repository";
import { decryptApiKey, encryptApiKey, lastFour, maskApiKey } from "./crypto";
import { readEncryptionKey } from "./env";
import { getProvider, ProviderError } from "./providers";

// Todas las reglas de la spec 001 viven aquí (plan §4). La key completa nunca sale de este módulo.

export const MAX_PROMPT = 4000;

// Texto por defecto aprobado en la spec. {nombre de la empresa} se reemplaza al hablar con el LLM (003).
export const DEFAULT_PROMPT = `Eres el asistente virtual de {nombre de la empresa}. Atiendes a los clientes por chat en español, con un tono cordial, claro y profesional.
Responde de forma breve y directa. Si la pregunta no es clara, pide que la aclaren.
Saluda solo al inicio de la conversación y preséntate como el asistente de {nombre de la empresa}.`;

// Principios 8–10 de la constitución: se muestran, no se editan (FR-005).
export const FIXED_RULES = [
  "No inventa respuestas.",
  "Pasa la conversación a una persona cuando no sabe, cuando el cliente está enojado o cuando pide varias veces hablar con alguien.",
  "Solo informa sobre tu empresa y agenda citas.",
];

export type Field = "companyName" | "prompt" | "provider" | "model" | "apiKey" | "form";
export type FieldErrors = Partial<Record<Field, string>>;

export interface PublicConfig {
  companyName: string;
  prompt: string;
  provider: string | null;
  model: string | null;
  apiKeyMask: string | null; // "…abcd"
  complete: boolean;
  missing: string[];
}

export interface ConfigInput {
  companyName: string;
  prompt: string;
  provider: string; // "" = sin proveedor
  model: string; // "" = sin modelo
  apiKey: string; // "" = conservar la guardada (FR-008)
}

export type SaveResult = { ok: true; config: PublicConfig } | { ok: false; errors: FieldErrors };
export type ModelsResult = { ok: true; models: string[] } | { ok: false; errors: FieldErrors };

const masterKey = () => readEncryptionKey(process.env.ENCRYPTION_KEY);

// null si no hay key o si ya no se puede descifrar (ENCRYPTION_KEY cambió, plan §8).
function savedKey(row: ConfigRow | null): string | null {
  return row?.apiKeyEncrypted ? decryptApiKey(row.apiKeyEncrypted, masterKey()) : null;
}

function toPublic(row: ConfigRow | null): PublicConfig {
  const keyOk = savedKey(row) !== null;
  const missing = [
    !row?.companyName && "el nombre",
    !row?.provider && "el proveedor",
    !row?.model && "el modelo",
    !keyOk && (row?.apiKeyEncrypted ? "volver a ingresar la API key" : "la API key"),
  ].filter((m): m is string => !!m);
  return {
    companyName: row?.companyName ?? "",
    prompt: row?.prompt ?? DEFAULT_PROMPT,
    provider: row?.provider ?? null,
    model: row?.model ?? null,
    apiKeyMask: keyOk && row?.apiKeyLast4 ? maskApiKey(row.apiKeyLast4) : null,
    complete: missing.length === 0,
    missing,
  };
}

export async function getConfig(): Promise<PublicConfig> {
  return toPublic(await readConfig());
}

function providerErrors(error: unknown, providerName: string): FieldErrors {
  if (!(error instanceof ProviderError)) throw error;
  return error.kind === "invalid_key"
    ? { apiKey: `${providerName} rechazó la API key. Revisa que sea correcta y de ${providerName}.` }
    : { form: `No se pudo verificar con ${providerName}. Reintenta en unos segundos.` };
}

// "Cargar modelos": con una key nueva la verifica; sin key usa la guardada si es del mismo proveedor (plan §3).
export async function loadModels(providerId: string, apiKeyInput: string): Promise<ModelsResult> {
  const provider = getProvider(providerId);
  if (!provider) return { ok: false, errors: { provider: "Elige un proveedor de la lista." } };
  const newKey = apiKeyInput.trim();
  const row = await readConfig();
  const key = newKey || (row?.provider === providerId ? savedKey(row) : null);
  if (!key) return { ok: false, errors: { apiKey: `Ingresa la API key de ${provider.name}.` } };
  try {
    if (newKey) await provider.verifyKey(newKey);
    return { ok: true, models: await provider.listChatModels(key) };
  } catch (e) {
    return { ok: false, errors: providerErrors(e, provider.name) };
  }
}

export async function saveConfig(input: ConfigInput): Promise<SaveResult> {
  const companyName = input.companyName.trim();
  const prompt = input.prompt;
  const newKey = input.apiKey.trim();
  const row = await readConfig();
  const errors: FieldErrors = {};

  if (!companyName) errors.companyName = "El nombre de la empresa es obligatorio.";
  if (!prompt.trim()) errors.prompt = "El prompt no puede estar vacío. Puedes restaurar el prompt por defecto.";
  else if (prompt.length > MAX_PROMPT) errors.prompt = `El prompt supera el máximo de ${MAX_PROMPT} caracteres.`;

  const provider = input.provider ? getProvider(input.provider) : undefined;
  if (input.provider && !provider) errors.provider = "Elige un proveedor de la lista.";
  if (!provider && (input.model || newKey)) errors.provider = "Elige un proveedor.";

  // FR-009: cambiar de proveedor exige key nueva; también si la guardada ya no se puede descifrar.
  const keepKey = provider && !newKey && row?.provider === provider.id ? savedKey(row) : null;
  if (provider && !newKey && !keepKey) errors.apiKey = `Ingresa la API key de ${provider.name}.`;

  if (Object.keys(errors).length) return { ok: false, errors };

  const key = newKey || keepKey;
  if (provider && key) {
    try {
      // El navegador no es confiable: la key nueva se verifica otra vez al guardar (SC-006).
      if (newKey) await provider.verifyKey(newKey);
      // El modelo se contrasta con la lista real solo si cambió algo que lo afecta.
      if (input.model && (newKey || input.model !== row?.model)) {
        const models = await provider.listChatModels(key);
        if (!models.includes(input.model)) return { ok: false, errors: { model: "Ese modelo no está disponible en el proveedor." } };
      }
    } catch (e) {
      return { ok: false, errors: providerErrors(e, provider.name) };
    }
  }

  const saved = await saveRow({
    companyName,
    prompt,
    provider: provider?.id ?? null,
    model: (provider && input.model) || null,
    apiKeyEncrypted: provider ? (newKey ? encryptApiKey(newKey, masterKey()) : row!.apiKeyEncrypted) : null,
    apiKeyLast4: provider ? (newKey ? lastFour(newKey) : row!.apiKeyLast4) : null,
  });
  return { ok: true, config: toPublic(saved) };
}
