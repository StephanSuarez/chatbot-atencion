import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending } from "../../lib/conversations/service";
import { Tabs } from "../tabs";
import { ChatView } from "./chat-view";

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  const [config, pending] = await Promise.all([getConfig(), countPending()]);
  return (
    <>
      <Tabs active="probar" pending={pending} />
      <ChatView ready={config.complete} missing={config.missing} companyName={config.companyName} />
    </>
  );
}
