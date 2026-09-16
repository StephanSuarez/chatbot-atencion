import { connection } from "next/server";
import { getConfig } from "../../lib/config-service";
import { countPending, listConversations, type TypeFilter } from "../../lib/conversations/service";
import { Tabs } from "../tabs";
import { ConversationsView } from "./list-view";
import { rangeOf, type Preset } from "./range";

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

  const [conversations, pending, config] = await Promise.all([
    listConversations({ type, ...rangeOf(preset, from, to) }),
    countPending(),
    getConfig(),
  ]);

  return (
    <>
      <Tabs active="conversaciones" pending={pending} />
      <ConversationsView conversations={conversations} filters={{ type, preset, from, to }} companyName={config.companyName} />
    </>
  );
}
