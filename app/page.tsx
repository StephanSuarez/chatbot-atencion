import { connection } from "next/server";
import { DEFAULT_PROMPT, FIXED_RULES, getConfig, MAX_PROMPT } from "../lib/config-service";
import { providers } from "../lib/providers";
import { ConfigForm } from "./config-form";

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  const config = await getConfig();
  return (
    <ConfigForm
      initial={config}
      providers={providers.map(({ id, name }) => ({ id, name }))}
      rules={FIXED_RULES}
      defaultPrompt={DEFAULT_PROMPT}
      maxPrompt={MAX_PROMPT}
    />
  );
}
