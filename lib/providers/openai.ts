import { EMBEDDING_MODEL, embeddings, getJson, modelsFrom } from "./http";
import type { Provider } from "./index";

const MODELS_URL = "https://api.openai.com/v1/models";

// La API no indica capacidades: se filtra por nombre (plan §6). Revisar cuando OpenAI saque familias nuevas.
const NOT_CHAT = /embedding|whisper|tts|audio|realtime|transcribe|dall-e|image|moderation|sora|davinci|babbage/;

export const openai: Provider = {
  id: "openai",
  name: "OpenAI",
  // Listar modelos exige una key válida: sirve como verificación.
  async verifyKey(apiKey) {
    await getJson("openai", MODELS_URL, apiKey);
  },
  async listChatModels(apiKey) {
    const models = modelsFrom("openai", await getJson("openai", MODELS_URL, apiKey));
    return models
      .map((m) => m.id as string)
      .filter((id) => !NOT_CHAT.test(id))
      .sort();
  },
  async embed(texts, apiKey) {
    return embeddings("openai", "https://api.openai.com/v1/embeddings", EMBEDDING_MODEL, texts, apiKey);
  },
};
