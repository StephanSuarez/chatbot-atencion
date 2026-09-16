"use client";

import { useState } from "react";
import type { ReasonBreakdown, Summary, Topic } from "../../lib/metrics/service";
import c from "../config.module.css";
import s from "./conversaciones.module.css";

// Las métricas son los mismos datos de «Conversaciones» vistos de otra forma (plan 008 §3).
// Se calculan en el servidor con el mismo periodo del filtro: aquí solo se muestran.

export interface Metrics {
  summary: Summary;
  reasons: ReasonBreakdown;
  topics: Topic[];
}

const REASON_LABEL: Record<keyof ReasonBreakdown, string> = {
  no_sabe: "No tenía la información",
  enojo: "Cliente enojado",
  pide_persona: "Pidió hablar con una persona",
  sin_registrar: "Sin motivo registrado",
};

export function MetricsView({ metrics }: { metrics: Metrics }) {
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const { summary, reasons, topics } = metrics;

  if (!summary.total) {
    return (
      <div className={s.empty}>
        <span className={s.bigIcon}><ChartIcon /></span>
        <h2>No hay conversaciones en este periodo</h2>
        <p>Cambia las fechas o espera a que tu chatbot converse con alguien.</p>
      </div>
    );
  }

  const derivedReasons = (Object.keys(REASON_LABEL) as (keyof ReasonBreakdown)[]).filter((reason) => reasons[reason] > 0);

  return (
    <div className={s.metrics}>
      <div className={s.cards}>
        <Card value={summary.total} label="Conversaciones" />
        <Card value={summary.solvedByBot} label="Las resolvió el bot" tone="ok" />
        <Card value={summary.derived} label="Pasaron a una persona" tone="warn" />
        <Card value={summary.pending} label="Esperan respuesta" tone={summary.pending ? "alert" : undefined} />
      </div>

      <div className={s.rate}>
        <div className={s.rateBar}>
          <span className={s.rateFill} style={{ width: `${summary.resolutionRate}%` }} />
        </div>
        <span className={s.rateText}>
          El chatbot resolvió solo el <strong>{summary.resolutionRate} %</strong> de las conversaciones.
        </span>
      </div>

      {derivedReasons.length > 0 && (
        <section className={s.metricsBlock}>
          <h3 className={s.metricsTitle}>Por qué pasaron a una persona</h3>
          <ul className={s.reasons}>
            {derivedReasons.map((reason) => (
              <li key={reason} className={s.reason}>
                <span>{REASON_LABEL[reason]}</span>
                <strong>{reasons[reason]}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.metricsBlock}>
        <h3 className={s.metricsTitle}>Lo que más preguntan</h3>
        {topics.length === 0 ? (
          <p className={c.help}>Todavía no hay preguntas suficientes para agrupar temas.</p>
        ) : (
          <ul className={s.topics}>
            {topics.map((topic) => (
              <li key={topic.title} className={s.topic}>
                <button
                  type="button"
                  className={s.topicHead}
                  aria-expanded={openTopic === topic.title}
                  onClick={() => setOpenTopic(openTopic === topic.title ? null : topic.title)}
                >
                  <span className={s.topicTitle}>{topic.title}</span>
                  <span className={s.topicCounts}>
                    {topic.derivedCount > 0 && (
                      <span className={s.tagDer} title="Veces que el bot no supo responder">
                        {topic.derivedCount} sin respuesta
                      </span>
                    )}
                    <span className={s.topicCount}>{topic.count}</span>
                  </span>
                </button>
                {openTopic === topic.title && (
                  <ul className={s.examples}>
                    {topic.examples.map((example, i) => (
                      <li key={i}>«{example}»</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Card({ value, label, tone }: { value: number; label: string; tone?: "ok" | "warn" | "alert" }) {
  const toneClass = tone === "ok" ? s.cardOk : tone === "warn" ? s.cardWarn : tone === "alert" ? s.cardAlert : "";
  return (
    <div className={`${s.metricCard} ${toneClass}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

const ChartIcon = () => (
  <svg width={26} height={26} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" aria-hidden="true">
    <path d="M2 13.5h12M4 11V7M8 11V3.5M12 11v-5" />
  </svg>
);
