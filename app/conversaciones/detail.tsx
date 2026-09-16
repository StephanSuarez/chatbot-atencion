"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MAX_FILE_BYTES, ACCEPTED_EXTENSIONS } from "../../lib/attachments/validate";
import type { Entry, Mode } from "../../lib/conversations/service";
import { ChipArchivo, ClipIcon, deEntrada, VistaAdjunto } from "../adjunto";
import { call } from "../call";
import c from "../config.module.css";
import { conversationAction, replyAction, setModeAction } from "./actions";
import { MAX_REPLY } from "./limits";
import s from "./conversaciones.module.css";

// Cada 3 s se preguntan los mensajes nuevos del cliente (plan 004 §3). No llama al modelo.
const POLL_MS = 3000;

const AUTHOR: Record<string, string> = { cliente: "Cliente", bot: "Bot", equipo: "Equipo" };

interface Props {
  id: string;
  companyName: string;
  onBack: () => void;
  onGone: () => void;
  onChanged: () => void;
}

export function Detail({ id, companyName, onBack, onGone, onChanged }: Props) {
  const [entries, setEntries] = useState<(Entry & { when: string })[]>([]);
  const [mode, setMode] = useState<Mode>("ia");
  const [derived, setDerived] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [working, startWorking] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  // Una sola URL por archivo: crearla dentro del render la recrearía en cada pintado.
  const filePreview = useMemo(() => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file]);
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
    lastSeq.current = Math.max(lastSeq.current, result.entries[result.entries.length - 1].seq);
    // Dos consultas a la vez (en desarrollo React monta los efectos dos veces) traerían lo mismo:
    // se descarta lo que ya está en pantalla en vez de duplicarlo.
    setEntries((before) => {
      const seen = new Set(before.map((entry) => entry.seq));
      const nuevas = result.entries.filter((entry) => !seen.has(entry.seq));
      return nuevas.length ? [...before, ...nuevas] : before;
    });
  }, [id]);

  useEffect(() => {
    const tick = () => {
      if (!busy.current && document.visibilityState === "visible") void pull();
    };
    // La primera carga va siempre, como en el chat (KAN-32): si se condiciona a que la pestaña esté
    // visible, abrir el detalle en segundo plano deja la conversación vacía y con el modo equivocado.
    void pull();
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
    // Una respuesta solo con archivo es válida (010, FR-005).
    if ((!text && !file) || working) return;
    setError(null);
    busy.current = true;
    startWorking(async () => {
      // El archivo obliga a FormData, igual que en el chat del cliente.
      const form = new FormData();
      form.set("id", id);
      form.set("text", text);
      if (file) form.set("file", file);

      const result = await call(() => replyAction(form), { ok: false, error: "No pudimos contactar al servidor." });
      if (result.ok) {
        setDraft("");
        setFile(null);
      } else {
        // El archivo sigue elegido: reintentar no obliga a buscarlo otra vez.
        setError(result.error ?? "No se pudo enviar.");
      }
      busy.current = false;
      await pull();
      handlers.current.onChanged();
    });
  }

  function choose(chosen: File | null) {
    if (!chosen) return;
    if (chosen.size > MAX_FILE_BYTES) {
      setError(`“${chosen.name}” pesa más de 4 MB.`);
      return;
    }
    setError(null);
    setFile(chosen);
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
              {entry.text} · {entry.when}
            </div>
          ) : (
            <div
              key={entry.seq}
              className={entry.author === "cliente" ? s.fromClient : entry.author === "bot" ? s.fromBot : s.fromTeam}
            >
              <span className={s.author}>
                {entry.author === "equipo" ? `Equipo de ${companyName}` : AUTHOR[entry.author]} · {entry.when}
              </span>
              {entry.attachment && <VistaAdjunto adjunto={deEntrada(entry.attachment)} conTexto={!!entry.text} />}
              {entry.text}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      {file && (
        <div className={s.replyChip}>
          <ChipArchivo file={file} preview={filePreview} sending={working} onRemove={() => setFile(null)} />
        </div>
      )}

      <form
        className={s.replyBar}
        onSubmit={(e) => {
          e.preventDefault();
          reply();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          className={c.srOnly}
          // Lo abre el botón de al lado: oculto pero enfocable sería un punto de tabulación invisible.
          tabIndex={-1}
          accept={ACCEPTED_EXTENSIONS.join(",")}
          onChange={(e) => {
            choose(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={s.replyAttach}
          aria-label="Adjuntar un archivo"
          disabled={mode === "ia" || working}
          onClick={() => fileInput.current?.click()}
        >
          <ClipIcon />
        </button>
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
