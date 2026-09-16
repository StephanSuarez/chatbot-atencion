import { describe, expect, it } from "vitest";
import { rangeOf } from "./range";

// Un miércoles a media tarde; los atajos se calculan sobre la fecha local.
const now = new Date(2026, 8, 16, 15, 30);
const day = (d: number) => new Date(2026, 8, d);

describe("atajos de fecha del filtro (FR-020)", () => {
  it("sin filtro no acota nada", () => {
    expect(rangeOf("siempre", "", "", now)).toEqual({});
  });

  it("hoy va del inicio del día al inicio del siguiente", () => {
    expect(rangeOf("hoy", "", "", now)).toEqual({ from: day(16), to: day(17) });
  });

  it("ayer termina donde empieza hoy", () => {
    expect(rangeOf("ayer", "", "", now)).toEqual({ from: day(15), to: day(16) });
  });

  it("los últimos 7 y 30 días incluyen hoy completo", () => {
    expect(rangeOf("7dias", "", "", now)).toEqual({ from: day(10), to: day(17) });
    expect(rangeOf("30dias", "", "", now)).toEqual({ from: new Date(2026, 7, 18), to: day(17) });
  });

  it("personalizada incluye el día final completo", () => {
    expect(rangeOf("personalizada", "2026-09-01", "2026-09-03", now)).toEqual({ from: day(1), to: day(4) });
  });

  it("personalizada con fechas vacías o inválidas deja el lado abierto", () => {
    expect(rangeOf("personalizada", "", "2026-09-03", now)).toEqual({ from: undefined, to: day(4) });
    expect(rangeOf("personalizada", "no-es-fecha", "", now)).toEqual({ from: undefined, to: undefined });
  });
});
