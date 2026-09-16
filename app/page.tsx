import { connection } from "next/server";
import { countPending } from "../lib/conversations/service";
import { DEFAULT_PROMPT, FIXED_RULES, getConfig, MAX_PROMPT } from "../lib/config-service";
import { providers } from "../lib/providers";
import { ConfigForm } from "./config-form";

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  const [config, pending] = await Promise.all([getConfig(), countPending()]);
  return (
    <ConfigForm
      initial={config}
      pending={pending}
      providers={providers.map(({ id, name }) => ({ id, name }))}
      rules={FIXED_RULES}
      defaultPrompt={DEFAULT_PROMPT}
      maxPrompt={MAX_PROMPT}
    />
  );
}
