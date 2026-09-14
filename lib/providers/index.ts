import { openai } from "./openai";
import { openrouter } from "./openrouter";

export { ProviderError, type ProviderErrorKind } from "./http";

// Registro de proveedores de LLM (FR-006). Agregar uno = implementar estas dos operaciones y sumarlo a la lista.
export interface Provider {
  id: string;
  name: string;
  // Lanza ProviderError("invalid_key" | "unavailable") si la key no se puede verificar.
  verifyKey(apiKey: string): Promise<void>;
  listChatModels(apiKey: string): Promise<string[]>;
}

export const providers: Provider[] = [openai, openrouter];

export const getProvider = (id: string) => providers.find((p) => p.id === id);
