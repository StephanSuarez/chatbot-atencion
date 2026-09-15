import type { ChatMessage } from "./http";
import { openai } from "./openai";
import { openrouter } from "./openrouter";

export { EMBEDDING_MODEL, ProviderError, type ChatMessage, type ProviderErrorKind } from "./http";

// Registro de proveedores de LLM (FR-006). Agregar uno = implementar estas operaciones y sumarlo a la lista.
export interface Provider {
  id: string;
  name: string;
  // Lanzan ProviderError si el proveedor rechaza la solicitud o no responde (tipos en http.ts).
  verifyKey(apiKey: string): Promise<void>;
  listChatModels(apiKey: string): Promise<string[]>;
  embed(texts: string[], apiKey: string): Promise<number[][]>;
  chat(messages: ChatMessage[], model: string, apiKey: string): Promise<string>;
}

export const providers: Provider[] = [openai, openrouter];

export const getProvider = (id: string) => providers.find((p) => p.id === id);
