// Atajos de fecha del filtro (FR-020), sobre la fecha del último mensaje.
// ponytail: se calcula con la hora del servidor; si el equipo trabaja en otra zona horaria, se pasa la del navegador.

export type Preset = "siempre" | "hoy" | "ayer" | "7dias" | "30dias" | "personalizada";

export const PRESET_LABEL: Record<Preset, string> = {
  siempre: "Cualquier fecha",
  hoy: "Hoy",
  ayer: "Ayer",
  "7dias": "Últimos 7 días",
  "30dias": "Últimos 30 días",
  personalizada: "Personalizada",
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const daysAgo = (days: number, now: Date) => startOfDay(new Date(now.getTime() - days * 86_400_000));
const parse = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
};
const nextDay = (date: Date) => new Date(date.getTime() + 86_400_000);

/** `to` es exclusivo: para incluir un día completo se pasa el día siguiente. */
export function rangeOf(preset: Preset, from: string, to: string, now = new Date()): { from?: Date; to?: Date } {
  const today = startOfDay(now);
  switch (preset) {
    case "hoy":
      return { from: today, to: nextDay(today) };
    case "ayer":
      return { from: daysAgo(1, now), to: today };
    case "7dias":
      return { from: daysAgo(6, now), to: nextDay(today) };
    case "30dias":
      return { from: daysAgo(29, now), to: nextDay(today) };
    case "personalizada": {
      const desde = parse(from);
      const hasta = parse(to);
      return { from: desde, to: hasta && nextDay(hasta) };
    }
    default:
      return {};
  }
}
