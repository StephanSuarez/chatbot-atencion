import { EMBEDDING_MODEL, embeddings, getJson, modelsFrom } from "./http";
import type { Provider } from "./index";

export const openrouter: Provider = {
  id: "openrouter",
  name: "OpenRouter",
  // La lista de modelos es pública y no verifica nada: la key se verifica con /key (plan §6).
  async verifyKey(apiKey) {
    await getJson("openrouter", "https://openrouter.ai/api/v1/key", apiKey);
  },
  async listChatModels() {
    const models = modelsFrom("openrouter", await getJson("openrouter", "https://openrouter.ai/api/v1/models"));
    return models
      .filter((m) => {
        const output = (m.architecture as { output_modalities?: unknown } | undefined)?.output_modalities;
        return Array.isArray(output) && output.includes("text");
      })
      .map((m) => m.id as string)
      .sort();
  },
  async embed(texts, apiKey) {
    return embeddings("openrouter", "https://openrouter.ai/api/v1/embeddings", `openai/${EMBEDDING_MODEL}`, texts, apiKey);
  },
};
