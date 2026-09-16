import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { Tabs } from "../tabs";
import { ChatView } from "./chat-view";

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  const config = await getConfig();
  return (
    <>
      <Tabs active="probar" />
      <ChatView ready={config.complete} missing={config.missing} companyName={config.companyName} />
    </>
  );
}
