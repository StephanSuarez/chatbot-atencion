"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { Entry, Mode } from "../../lib/conversations/service";
import { call } from "../call";
import c from "../config.module.css";
import { conversationAction, replyAction, setModeAction } from "./actions";
import { MAX_REPLY } from "./limits";
import s from "./conversaciones.module.css";

// Cada 3 s se preguntan los mensajes nuevos del cliente (plan 004 §3). No llama al modelo.
const POLL_MS = 3000;

const time = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });
const AUTHOR: Record<string, string> = { cliente: "Cliente", bot: "Bot", equipo: "Equipo" };

interface Props {
  id: string;
  companyName: string;
  onBack: () => void;
  onGone: () => void;
  onChanged: () => void;
}

export function Detail({ id, companyName, onBack, onGone, onChanged }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [mode, setMode] = useState<Mode>("ia");
  const [derived, setDerived] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, startWorking] = useTransition();
  const lastSeq = useRef(0);
  const busy = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  // El padre pasa funciones nuevas en cada render: si el sondeo dependiera de ellas, se reiniciaría siempre.
  const handlers = useRef({ onGone, onChanged });
  useEffect(() => {
    handlers.current = { onGone, onChanged };
  });

  const pull = useCallback(async () => {
    const result = await call(() => conversationAction(id, lastSeq.current), undefined);
    if (result === null) {
      handlers.current.onGone();
      return;
    }
    if (!result) return;
    setMode(result.mode);
    setDerived(result.derived);
    if (!result.entries.length) return;
    lastSeq.current = result.entries[result.entries.length - 1].seq;
    setEntries((before) => [...before, ...result.entries]);
  }, [id]);

  useEffect(() => {
    const tick = () => {
      if (!busy.current && document.visibilityState === "visible") void pull();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pull]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  function change(next: Mode) {
    if (next === mode || working) return;
    setError(null);
    busy.current = true;
    startWorking(async () => {
      const result = await call(() => setModeAction(id, next), { ok: false, error: "No pudimos contactar al servidor." });
      if (!result.ok) setError(result.error ?? "No se pudo cambiar el modo.");
      busy.current = false;
      await pull();
      handlers.current.onChanged();
    });
  }

  function reply() {
    const text = draft.trim();
    if (!text || working) return;
    setError(null);
    busy.current = true;
    startWorking(async () => {
      const result = await call(() => replyAction(id, text), { ok: false, error: "No pudimos contactar al servidor." });
      if (result.ok) setDraft("");
      else setError(result.error ?? "No se pudo enviar.");
      busy.current = false;
      await pull();
      handlers.current.onChanged();
    });
  }

  const tooLong = draft.length > MAX_REPLY;

  return (
    <div className={s.detail}>
      <div className={s.detailBar}>
        <div className={s.detailTitles}>
          <button type="button" className={s.back} onClick={onBack}>
            ← Volver a la lista
          </button>
          <span className={s.detailTitle}>Conversación</span>
          <span className={s.detailMeta}>
            Chat de prueba{derived ? " · la derivó el bot" : ""}
          </span>
        </div>
        <div className={s.seg} role="group" aria-label="Quién responde">
          <button
            type="button"
            className={mode === "ia" ? `${s.segItem} ${s.segOn}` : s.segItem}
            aria-pressed={mode === "ia"}
            disabled={working}
            onClick={() => change("ia")}
          >
            <i className={`${s.bullet} ${s.bulletIa}`} /> Responde la IA
          </button>
          <button
            type="button"
            className={mode === "humano" ? `${s.segItem} ${s.segOn}` : s.segItem}
            aria-pressed={mode === "humano"}
            disabled={working}
            onClick={() => change("humano")}
          >
            <i className={`${s.bullet} ${s.bulletHuman}`} /> Respondes tú
          </button>
        </div>
      </div>

      {error && (
        <div className={`${c.notice} ${s.error}`} role="alert">
          <span>{error}</span>
        </div>
      )}

      <div className={s.timeline} aria-live="polite">
        {entries.map((entry) =>
          entry.author === "nota" ? (
            <div key={entry.seq} className={s.note}>
              <span className={s.noteLabel}>Nota del bot</span>
              {entry.text}
            </div>
          ) : entry.author === "evento" ? (
            <div key={entry.seq} className={s.event}>
              {entry.text} · {time.format(entry.createdAt)}
            </div>
          ) : (
            <div
              key={entry.seq}
              className={entry.author === "cliente" ? s.fromClient : entry.author === "bot" ? s.fromBot : s.fromTeam}
            >
              <span className={s.author}>
                {entry.author === "equipo" ? `Equipo de ${companyName}` : AUTHOR[entry.author]} · {time.format(entry.createdAt)}
              </span>
              {entry.text}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form
        className={s.replyBar}
        onSubmit={(e) => {
          e.preventDefault();
          reply();
        }}
      >
        <label htmlFor="respuesta" className={c.srOnly}>Respuesta al cliente</label>
        <textarea
          id="respuesta"
          rows={1}
          className={s.replyField}
          value={draft}
          disabled={mode === "ia" || working}
          aria-invalid={tooLong}
          placeholder={mode === "ia" ? "Pasa a «Respondes tú» para escribir" : "Escribe tu respuesta…"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              reply();
            }
          }}
        />
        <button
          type="submit"
          className={`${c.primary} ${s.replySend}`}
          aria-label="Enviar respuesta"
          disabled={mode === "ia" || working || tooLong || !draft.trim()}
        >
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

const SendIcon = () => (
  <svg width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 13V3.5M4 7.5 8 3.5l4 4" />
  </svg>
);
