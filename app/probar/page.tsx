import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending } from "../../lib/conversations/service";
import {
  listQuestions,
  listResults,
  listSimulations,
  markStale,
  type SimulationSummary,
} from "../../lib/simulations/service";
import { Tabs } from "../tabs";
import { ChatView } from "./chat-view";
import { SimulationsView } from "./simulaciones-view";

// La fecha se formatea aquí, en el servidor: hacerlo en el navegador usa otra zona horaria y rompe
// la hidratación (error visto en dev el 2026-09-15).
const fecha = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function label(simulation: SimulationSummary): string {
  const when = fecha.format(simulation.createdAt);
  if (simulation.status === "en_curso") return `${when} · en curso`;
  if (simulation.status === "interrumpida") return `${when} · interrumpida`;
  return `${when} · ${simulation.met} de ${simulation.total}`;
}

export default async function Page() {
  // La configuración se lee en cada request, no al compilar.
  await connection();
  // Una simulación que quedó colgada (por ejemplo, al reiniciar el servidor) no debe bloquear la siguiente.
  await markStale();
  const [config, pending, questions, recent] = await Promise.all([
    getConfig(),
    countPending(),
    listQuestions(),
    listSimulations(),
  ]);

  const newest = recent[0];
  const initial = newest ? { summary: newest, results: await listResults(newest.id) } : null;

  return (
    <>
      <Tabs active="probar" pending={pending} />
      <ChatView ready={config.complete} missing={config.missing} companyName={config.companyName} />
      <SimulationsView
        questions={questions}
        reports={recent.map((simulation) => ({ id: simulation.id, label: label(simulation) }))}
        initial={initial}
        ready={config.complete}
      />
    </>
  );
}
