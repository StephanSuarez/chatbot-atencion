"use client";

import { useCallback, useEffect, useState } from "react";
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

// Preguntas de prueba, ejecución e informes (plan 009 §4). El trabajo corre en el servidor: aquí solo
// se consulta el avance mientras la simulación está en curso.

const POLL_MS = 2000;

const EXPECTATION_LABEL: Record<Expectation, string> = {
  responde: "Debe responder",
  deriva: "Debe pasar a una persona",
  ninguna: "Solo ver qué contesta",
};

export interface Report {
  summary: SimulationSummary;
  results: ResultRow[];
}

/** Un informe anterior, con su fecha ya formateada en el servidor para no romper la hidratación. */
export interface ReportOption {
  id: string;
  label: string;
}

interface Props {
  questions: Question[];
  reports: ReportOption[];
  /** El informe más reciente, ya cargado en el servidor: al abrir no hace falta ir a buscarlo. */
  initial: Report | null;
  ready: boolean;
}

export function SimulationsView({ questions, reports, initial, ready }: Props) {
  const [text, setText] = useState("");
  const [expectation, setExpectation] = useState<Expectation>("responde");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [viewing, setViewing] = useState<string | null>(initial?.summary.id ?? null);
  const [report, setReport] = useState<Report | null>(initial);
  const [working, setWorking] = useState(false);

  const refresh = useCallback(async (id: string) => {
    const state = await call(() => simulationStateAction(id), null);
    if (state) setReport(state);
  }, []);

  const status = report?.summary.status;

  // El efecto solo monta el reloj: la primera carga ya vino del servidor y las demás las pide el reloj
  // o un clic. Mientras no esté en curso no hay nada que consultar.
  useEffect(() => {
    if (!viewing || status !== "en_curso") return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh(viewing);
    };
    const timer = setInterval(tick, POLL_MS);
    return () => clearInterval(timer);
  }, [viewing, status, refresh]);

  async function show(id: string) {
    setViewing(id);
    setReport(null);
    const state = await call(() => simulationStateAction(id), null);
    if (state) setReport(state);
  }

  function resetForm() {
    setEditing(null);
    setText("");
    setExpectation("responde");
  }

  async function saveQuestion() {
    if (!text.trim() || working) return;
    setError(null);
    setWorking(true);
    const result = await call(() => saveQuestionAction({ id: editing ?? undefined, text, expectation }), {
      ok: false,
      error: "No pudimos guardarla.",
    });
    if (result.ok) resetForm();
    else setError(result.error ?? "No pudimos guardarla.");
    setWorking(false);
  }

  function startEditing(question: Question) {
    setError(null);
    setEditing(question.id);
    setText(question.text);
    setExpectation(question.expectation);
  }

  async function removeQuestion(id: string) {
    setError(null);
    setWorking(true);
    const result = await call(() => deleteQuestionAction(id), { ok: false, error: "No pudimos borrarla." });
    if (!result.ok) setError(result.error ?? "No pudimos borrarla.");
    else if (editing === id) resetForm();
    setWorking(false);
  }

  async function run() {
    setError(null);
    setConfirming(false);
    setWorking(true);
    const result = await call(() => runSimulationAction(), { ok: false as const, error: "No pudimos empezar." });
    if (result.ok) {
      setViewing(result.id);
      // Se da por empezada sin esperar a consultarla: si esa consulta fallara, el reloj no arrancaría
      // y el avance no aparecería nunca.
      setReport({
        summary: {
          id: result.id,
          status: "en_curso",
          total: result.total,
          done: 0,
          met: 0,
          failed: 0,
          createdAt: new Date(),
        },
        results: [],
      });
    } else {
      setError(result.error);
    }
    setWorking(false);
  }

  const inProgress = status === "en_curso";

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
        <div className={c.field}>
          <label className={c.label} htmlFor="pregunta-texto">
            Pregunta de prueba
          </label>
          <input
            id="pregunta-texto"
            className={c.input}
            placeholder="¿Qué le preguntaría un cliente?"
            value={text}
            maxLength={1000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveQuestion();
              }
            }}
          />
        </div>

        <div className={c.field}>
          <label className={c.label} htmlFor="pregunta-expectativa">
            Qué se espera
          </label>
          <select
            id="pregunta-expectativa"
            className={c.input}
            value={expectation}
            onChange={(e) => setExpectation(e.target.value as Expectation)}
          >
            {(Object.keys(EXPECTATION_LABEL) as Expectation[]).map((option) => (
              <option key={option} value={option}>{EXPECTATION_LABEL[option]}</option>
            ))}
          </select>
        </div>

        <div className={s.formActions}>
          <button type="button" className={c.secondary} onClick={saveQuestion} disabled={!text.trim() || working}>
            {editing ? "Guardar" : "Agregar"}
          </button>
          {editing && (
            <button type="button" className={s.linkButton} onClick={resetForm} disabled={working}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      {questions.length === 0 ? (
        <p className={c.help}>Todavía no hay preguntas de prueba. Agrega la primera para poder simular.</p>
      ) : (
        <ul className={s.questions}>
          {questions.map((question) => (
            <li key={question.id} className={question.id === editing ? `${s.question} ${s.questionOn}` : s.question}>
              <span className={s.questionText}>{question.text}</span>
              <span className={s.questionTag}>{EXPECTATION_LABEL[question.expectation]}</span>
              <button
                type="button"
                className={s.linkButton}
                onClick={() => startEditing(question)}
                disabled={working || inProgress}
              >
                Editar
              </button>
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
              Simulación en curso: {report?.summary.done} de {report?.summary.total}.
            </span>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <div className={s.reportPicker}>
          <label className={c.label} htmlFor="informe">
            Informe
          </label>
          <select id="informe" className={c.input} value={viewing ?? ""} onChange={(e) => show(e.target.value)}>
            {/* La recién empezada no está en la lista del servidor hasta que la página se refresque. */}
            {viewing && !reports.some((option) => option.id === viewing) && (
              <option value={viewing}>Simulación en curso</option>
            )}
            {reports.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>
      )}

      {report && (
        <div className={s.report}>
          <div className={s.reportHead}>
            <strong>
              {report.summary.status === "en_curso"
                ? `En curso: ${report.summary.done} de ${report.summary.total}`
                : report.summary.status === "interrumpida"
                  ? "Simulación interrumpida"
                  : `${report.summary.met} de ${report.summary.total} como esperabas`}
            </strong>
            {report.summary.failed > 0 && (
              <span className={s.reportFailed}>{report.summary.failed} sin respuesta del proveedor</span>
            )}
          </div>

          <ul className={s.results}>
            {report.results.map((result, i) => (
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
