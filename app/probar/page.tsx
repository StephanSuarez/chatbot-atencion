import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending } from "../../lib/conversations/service";
import { listQuestions, listSimulations, markStale } from "../../lib/simulations/service";
import { Tabs } from "../tabs";
import { ChatView } from "./chat-view";
import { SimulationsView } from "./simulaciones-view";

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  // Una simulación que quedó colgada (por ejemplo, al reiniciar el servidor) no debe bloquear la siguiente.
  await markStale();
  const [config, pending, questions, recent] = await Promise.all([
    getConfig(),
    countPending(),
    listQuestions(),
    listSimulations(1),
  ]);

  return (
    <>
      <Tabs active="probar" pending={pending} />
      <ChatView ready={config.complete} missing={config.missing} companyName={config.companyName} />
      <SimulationsView questions={questions} last={recent[0] ?? null} ready={config.complete} />
    </>
  );
}
