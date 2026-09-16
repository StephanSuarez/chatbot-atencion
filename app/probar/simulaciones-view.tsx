"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Expectation, Question, ResultRow, SimulationSummary } from "../../lib/simulations/service";
import { call } from "../call";
import c from "../config.module.css";
import s from "./chat.module.css";
import {
  deleteQuestionAction,
  runSimulationAction,
  saveQuestionAction,
  simulationStateAction,
} from "./simulaciones-actions";

// Preguntas de prueba, ejecución e informes (plan 009 §4). El trabajo corre en el servidor:
// aquí solo se consulta el avance cada 2 s.

const POLL_MS = 2000;

const EXPECTATION_LABEL: Record<Expectation, string> = {
  responde: "Debe responder",
  deriva: "Debe pasar a una persona",
  ninguna: "Solo ver qué contesta",
};

interface Props {
  questions: Question[];
  /** La última simulación, esté corriendo o ya terminada: es el informe que se muestra al abrir. */
  last: SimulationSummary | null;
  ready: boolean;
}

export function SimulationsView({ questions, last, ready }: Props) {
  const [text, setText] = useState("");
  const [expectation, setExpectation] = useState<Expectation>("responde");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [current, setCurrent] = useState<{ summary: SimulationSummary; results: ResultRow[] } | null>(null);
  const [working, setWorking] = useState(false);
  const watching = useRef<string | null>(last?.id ?? null);

  const pull = useCallback(async () => {
    const id = watching.current;
    if (!id) return;
    const state = await call(() => simulationStateAction(id), null);
    if (state) setCurrent(state);
  }, []);

  useEffect(() => {
    void pull();
    const timer = setInterval(() => {
      if (current?.summary.status === "en_curso" && document.visibilityState === "visible") void pull();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pull, current?.summary.status]);

  async function addQuestion() {
    if (!text.trim() || working) return;
    setError(null);
    setWorking(true);
    const result = await call(() => saveQuestionAction({ text, expectation }), {
      ok: false,
      error: "No pudimos guardarla.",
    });
    if (result.ok) setText("");
    else setError(result.error ?? "No pudimos guardarla.");
    setWorking(false);
  }

  async function removeQuestion(id: string) {
    setWorking(true);
    await call(() => deleteQuestionAction(id), { ok: false });
    setWorking(false);
  }

  async function run() {
    setError(null);
    setConfirming(false);
    setWorking(true);
    const result = await call(() => runSimulationAction(), { ok: false as const, error: "No pudimos empezar." });
    if (result.ok) {
      watching.current = result.id;
      await pull();
    } else {
      setError(result.error);
    }
    setWorking(false);
  }

  const inProgress = current?.summary.status === "en_curso";

  return (
    <section className={s.simulations}>
      <header className={s.simHeader}>
        <div>
          <h2>Simulaciones</h2>
          <span className={c.help}>
            Guarda preguntas de prueba y córrelas todas de una vez para ver cómo responde tu chatbot.
          </span>
        </div>
      </header>

      {error && (
        <div className={s.error} role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className={s.questionForm}>
        <input
          className={c.input}
          placeholder="¿Qué le preguntaría un cliente?"
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void addQuestion();
            }
          }}
        />
        <select
          className={c.input}
          value={expectation}
          aria-label="Qué se espera del chatbot"
          onChange={(e) => setExpectation(e.target.value as Expectation)}
        >
          {(Object.keys(EXPECTATION_LABEL) as Expectation[]).map((option) => (
            <option key={option} value={option}>{EXPECTATION_LABEL[option]}</option>
          ))}
        </select>
        <button type="button" className={c.secondary} onClick={addQuestion} disabled={!text.trim() || working}>
          Agregar
        </button>
      </div>

      {questions.length === 0 ? (
        <p className={c.help}>Todavía no hay preguntas de prueba. Agrega la primera para poder simular.</p>
      ) : (
        <ul className={s.questions}>
          {questions.map((question) => (
            <li key={question.id} className={s.question}>
              <span className={s.questionText}>{question.text}</span>
              <span className={s.questionTag}>{EXPECTATION_LABEL[question.expectation]}</span>
              <button
                type="button"
                className={s.questionRemove}
                aria-label={`Borrar la pregunta ${question.text}`}
                onClick={() => removeQuestion(question.id)}
                disabled={working || inProgress}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <div className={s.confirmRun}>
          <p>
            Se le enviarán <strong>{questions.length}</strong> {questions.length === 1 ? "pregunta" : "preguntas"} a tu
            chatbot. Cada una consume saldo de tu API key.
          </p>
          <div className={s.runActions}>
            <button type="button" className={c.primary} onClick={run} disabled={working}>
              {working ? "Empezando…" : "Sí, ejecutar"}
            </button>
            <button type="button" className={c.secondary} onClick={() => setConfirming(false)} disabled={working}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className={s.runActions}>
          <button
            type="button"
            className={c.primary}
            onClick={() => setConfirming(true)}
            disabled={!questions.length || !ready || inProgress || working}
          >
            Ejecutar simulación
          </button>
          {!ready && <span className={c.help}>Completa la configuración de tu chatbot para poder simular.</span>}
          {inProgress && (
            <span className={c.help}>
              Simulación en curso: {current?.summary.done} de {current?.summary.total}.
            </span>
          )}
        </div>
      )}

      {current && (
        <div className={s.report}>
          <div className={s.reportHead}>
            <strong>
              {current.summary.status === "en_curso"
                ? `En curso: ${current.summary.done} de ${current.summary.total}`
                : current.summary.status === "interrumpida"
                  ? "Simulación interrumpida"
                  : `${current.summary.met} de ${current.summary.total} como esperabas`}
            </strong>
            {current.summary.failed > 0 && (
              <span className={s.reportFailed}>
                {current.summary.failed} sin respuesta del proveedor
              </span>
            )}
          </div>

          <ul className={s.results}>
            {current.results.map((result, i) => (
              <li key={i} className={s.result}>
                <span className={result.met === true ? s.resultOk : result.met === false ? s.resultBad : s.resultNeutral}>
                  {result.met === true ? "✓" : result.met === false ? "✗" : "—"}
                </span>
                <div className={s.resultBody}>
                  <strong>{result.question}</strong>
                  <span className={s.resultAnswer}>
                    {result.error ? `No se pudo: ${result.error}` : result.answer || "(sin respuesta)"}
                  </span>
                  <span className={s.resultMeta}>
                    {EXPECTATION_LABEL[result.expectation]} · {result.derived ? "pasó a una persona" : "respondió el bot"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
