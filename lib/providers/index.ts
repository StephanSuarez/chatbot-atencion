import { openai } from "./openai";
import { openrouter } from "./openrouter";

export { EMBEDDING_MODEL, ProviderError, type ProviderErrorKind } from "./http";

// Registro de proveedores de LLM (FR-006). Agregar uno = implementar estas operaciones y sumarlo a la lista.
export interface Provider {
  id: string;
  name: string;
  // Lanzan ProviderError("invalid_key" | "unavailable") si el proveedor rechaza la key o no responde.
  verifyKey(apiKey: string): Promise<void>;
  listChatModels(apiKey: string): Promise<string[]>;
  embed(texts: string[], apiKey: string): Promise<number[][]>;
}

export const providers: Provider[] = [openai, openrouter];

export const getProvider = (id: string) => providers.find((p) => p.id === id);
