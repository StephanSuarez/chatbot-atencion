import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending, listConversations, type TypeFilter } from "../../lib/conversations/service";
import { handoffReasons, summary, topics } from "../../lib/metrics/service";
import { Tabs } from "../tabs";
import { ConversationsView } from "./list-view";
import { rangeOf, type Preset } from "./range";

// La fecha se formatea aquí, en el servidor: hacerlo en el navegador usa otra zona horaria y rompe
// la hidratación (error visto en dev el 2026-09-15).
const fecha = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const TYPES: TypeFilter[] = ["todas", "derivadas", "sin_derivar"];
const PRESETS: Preset[] = ["siempre", "hoy", "ayer", "7dias", "30dias", "personalizada"];

export default async function Page({ searchParams }: Props) {
  // Las conversaciones se leen en cada request, no al compilar.
  await connection();
  const params = await searchParams;
  const type = (TYPES.find((t) => t === one(params.tipo)) ?? "todas") as TypeFilter;
  const preset = (PRESETS.find((p) => p === one(params.fecha)) ?? "siempre") as Preset;
  const from = one(params.desde);
  const to = one(params.hasta);

  const range = rangeOf(preset, from, to);
  const [conversations, pending, config, resumen, motivos, temas] = await Promise.all([
    listConversations({ type, ...range }),
    countPending(),
    getConfig(),
    summary(range),
    handoffReasons(range),
    topics(range),
  ]);

  return (
    <>
      <Tabs active="conversaciones" pending={pending} />
      <ConversationsView
        conversations={conversations.map((conversation) => ({ ...conversation, when: fecha.format(conversation.lastMessageAt) }))}
        filters={{ type, preset, from, to }}
        companyName={config.companyName}
        metrics={{ summary: resumen, reasons: motivos, topics: temas }}
      />
    </>
  );
}
