"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { FoundChunk } from "../../lib/chat/retrieve";
import type { Entry } from "../../lib/conversations/service";
import { call } from "../call";
import { joinEs, thousands } from "../config-form";
import c from "../config.module.css";
import { newEntriesAction, sendMessageAction } from "./actions";
import s from "./chat.module.css";

const MAX_MESSAGE = 1000;
// Cada 3 s se preguntan los mensajes nuevos del equipo (plan 004 §3). No llama al modelo: no gasta saldo.
const POLL_MS = 3000;
const STORAGE_KEY = "chatbot.conversacion";

interface Message {
  role: "user" | "assistant";
  author?: Entry["author"];
  content: string;
  sources?: FoundChunk[];
  failed?: string;
  // El mismo id al reintentar: el servidor no guarda el mensaje dos veces (004, FR-012).
  clientMessageId?: string;
}

// Los pedazos llegan con su encabezado de origen («[menu.txt]»); el origen ya se muestra aparte.
const withoutHeader = (text: string) => text.replace(/^\[[^\]\n]*\]\n/, "");

const fromEntry = (entry: Entry): Message => ({
  role: entry.author === "cliente" ? "user" : "assistant",
  author: entry.author,
  content: entry.text,
});

// Lo guardado solo existe en el navegador: en el servidor no hay localStorage y se empieza sin conversación.
const stored = (): string | undefined => {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
};

const remember = (id?: string) => {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Navegador sin almacenamiento: la conversación solo dura lo que dure la página.
  }
};

export function ChatView({ ready, missing, companyName }: { ready: boolean; missing: string[]; companyName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [mode, setMode] = useState<"ia" | "humano">("ia");
  const [draft, setDraft] = useState("");
  const [openSources, setOpenSources] = useState<Set<number>>(new Set());
  const [pendingInfo, setPendingInfo] = useState(false);
  const [blocked, setBlocked] = useState<string[] | null>(ready ? null : missing);
  const [sending, startSending] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const lastSeq = useRef(0);
  // Mientras hay un envío en vuelo no se consulta: si no, la respuesta llegaría por los dos caminos y se duplicaría.
  const busy = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, sending]);

  // Trae lo que haya escrito el equipo desde la última entrada conocida; null = la conversación ya no existe.
  const pull = useCallback(async (id: string) => {
    const result = await call(() => newEntriesAction(id, lastSeq.current), undefined);
    if (result === null) {
      remember(undefined);
      setConversationId(undefined);
      setMessages([]);
      lastSeq.current = 0;
      return;
    }
    if (!result) return;
    setMode(result.mode);
    if (!result.entries.length) return;
    lastSeq.current = result.entries[result.entries.length - 1].seq;
    setMessages((before) => [...before, ...result.entries.map(fromEntry)]);
  }, []);

  // El id guardado se lee ya montados: en el servidor no existe localStorage, y un estado inicial
  // calculado allí se quedaría vacío para siempre al hidratar (FR-005).
  useEffect(() => {
    void Promise.resolve().then(() => setConversationId((current) => current ?? stored()));
  }, []);

  // Al abrir se recupera la conversación que recuerda el navegador (FR-005) y luego se consulta cada 3 s.
  useEffect(() => {
    if (!conversationId) return;
    const tick = () => {
      if (!busy.current && document.visibilityState === "visible") void pull(conversationId);
    };
    // La primera carga va siempre: la pestaña puede abrirse en segundo plano y la conversación
    // guardada tiene que aparecer igual (FR-005).
    void pull(conversationId);
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [conversationId, pull]);

  const tooLong = draft.length > MAX_MESSAGE;

  function send(text: string, before: Message[], retryId?: string) {
    const clientMessageId = retryId ?? crypto.randomUUID();
    setMessages([...before, { role: "user", content: text, clientMessageId }]);
    busy.current = true;
    startSending(async () => {
      const result = await call(() => sendMessageAction({ conversationId, clientMessageId, message: text }), {
        ok: false as const,
        error: "No pudimos contactar al servidor. Revisa tu conexión e intenta de nuevo.",
      });
      if (result.ok) {
        setConversationId(result.conversationId);
        remember(result.conversationId);
        setMode(result.mode);
        if (result.entries.length) lastSeq.current = result.entries[result.entries.length - 1].seq;
        const replies = result.entries.map((entry, i) => ({
          ...fromEntry(entry),
          ...(i === 0 && entry.author === "bot" && { sources: result.sources }),
        }));
        setMessages([...before, { role: "user", content: text, clientMessageId }, ...replies]);
        setPendingInfo(result.pendingInfo);
      } else if ("missing" in result && result.missing) {
        setBlocked(result.missing);
      } else {
        if (result.conversationId) {
          setConversationId(result.conversationId);
          remember(result.conversationId);
        }
        setMessages([...before, { role: "user", content: text, failed: result.error, clientMessageId }]);
      }
      busy.current = false;
    });
  }

  function submit() {
    const text = draft.trim();
    if (!text || tooLong || sending) return;
    setDraft("");
    send(text, messages);
  }

  function newConversation() {
    remember(undefined);
    setConversationId(undefined);
    setMode("ia");
    lastSeq.current = 0;
    setMessages([]);
    setOpenSources(new Set());
    setDraft("");
    setPendingInfo(false);
  }

  function toggleSources(index: number) {
    const next = new Set(openSources);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpenSources(next);
  }

  return (
    <div className={`${c.page} ${s.page}`}>
      <header className={c.header}>
        <div className={c.titles}>
          <h1>Probar tu chatbot</h1>
          <p className={c.subtitle}>Escríbele como lo haría un cliente.</p>
        </div>
        {!blocked && messages.length > 0 && (
          <button type="button" className={`${c.secondary} ${s.newButton}`} onClick={newConversation} disabled={sending}>
            <NewIcon /> <span className={s.newLabel}>Nueva conversación</span>
          </button>
        )}
      </header>

      {pendingInfo && (
        <div className={c.notice}>
          <span>
            Parte de lo que sabe tu chatbot todavía no está lista, así que no la usa para responder. Revisa{" "}
            <Link href="/conocimiento">Lo que sabe</Link>.
          </span>
        </div>
      )}

      <section className={s.card}>
        {!blocked && (
          <p className={s.privacy}>
            <LockSmall /> Esta conversación se guarda para mejorar la atención.
          </p>
        )}
        <div className={s.thread} aria-live="polite">
          {blocked ? (
            <div className={s.center}>
              <span className={`${s.bigIcon} ${s.bigIconMuted}`}><LockIcon /></span>
              <h2>Tu chatbot todavía no está listo para conversar</h2>
              <p>
                {blocked.length === 1 ? "Falta" : "Faltan"} {joinEs(blocked)}.
              </p>
              <Link href="/" className={`${c.primary} ${s.linkButton}`}>Ir a Tu chatbot</Link>
            </div>
          ) : messages.length === 0 ? (
            <div className={s.center}>
              <span className={s.bigIcon}><ChatIcon /></span>
              <h2>¿Qué le preguntaría un cliente?</h2>
              <p>Por ejemplo: «¿A qué hora abren el sábado?». El bot responde solo con lo que sabe; si no lo sabe, pasa la conversación al equipo.</p>
            </div>
          ) : (
            messages.map((message, index) =>
              message.role === "user" ? (
                <div key={index} className={s.userTurn}>
                  <div className={s.me}>{message.content}</div>
                  {message.failed && (
                    <>
                      <span className={s.failed}>
                        No se pudo responder
                        {index === messages.length - 1 && !sending && (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className={s.retry}
                              onClick={() => send(message.content, messages.slice(0, index), message.clientMessageId)}
                            >
                              Reintentar
                            </button>
                          </>
                        )}
                      </span>
                      <div className={`${c.notice} ${s.error}`} role="alert">{message.failed}</div>
                    </>
                  )}
                </div>
              ) : message.author === "equipo" ? (
                <div key={index} className={s.botTurn}>
                  <div className={s.team}>
                    <span className={s.teamLabel}>
                      <i className={s.teamDot} /> Equipo de {companyName}
                    </span>
                    {message.content}
                  </div>
                </div>
              ) : (
                <div key={index} className={s.botTurn}>
                  <div className={s.bot}>{message.content}</div>
                  <button
                    type="button"
                    className={s.sourcesToggle}
                    aria-expanded={openSources.has(index)}
                    onClick={() => toggleSources(index)}
                  >
                    {openSources.has(index) ? "Ocultar en qué se basó" : "Ver en qué se basó"}
                    {openSources.has(index) ? <ChevronUp /> : <ChevronDown />}
                  </button>
                  {openSources.has(index) && (
                    <div className={s.sources}>
                      {message.sources?.length ? (
                        <>
                          <span className={c.help}>Lo que encontró en lo que sabe, del más al menos parecido a la pregunta.</span>
                          {message.sources.map((source, i) => (
                            <div key={i} className={s.source}>
                              <div className={s.sourceHead}>
                                <strong>{source.source}</strong>
                                <span className={s.pct} title="Qué tan parecido era a la pregunta">
                                  {Math.round(source.similarity * 100)} %
                                </span>
                              </div>
                              <span className={s.snippet}>{withoutHeader(source.text)}</span>
                            </div>
                          ))}
                        </>
                      ) : (
                        <span className={c.help}>
                          No encontró nada relacionado en lo que sabe, o la respuesta se recuperó al volver a abrir la conversación.
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ),
            )
          )}
          {sending && (
            <div className={`${s.bot} ${s.typing}`} role="status" aria-label="El bot está escribiendo">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={endRef} />
        </div>

        {mode === "humano" && !blocked && (
          <p className={s.waiting} role="status">
            <ClockIcon /> Una persona del equipo va a continuar esta conversación. Puedes seguir escribiendo.
          </p>
        )}

        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className={s.fieldWrap}>
            <label htmlFor="message" className={c.srOnly}>Mensaje</label>
            <textarea
              id="message"
              rows={1}
              className={s.field}
              value={draft}
              disabled={!!blocked || sending}
              placeholder={
                blocked ? "Configura tu chatbot para conversar" : sending ? "Espera la respuesta…" : "Escribe como si fueras un cliente…"
              }
              aria-invalid={tooLong}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            {draft.length > MAX_MESSAGE * 0.9 && (
              <div className={s.counterRow}>
                {tooLong ? <span className={c.err}>Acorta el mensaje para enviarlo.</span> : <span />}
                <span className={tooLong ? s.counterOver : s.counter}>
                  {thousands(draft.length)} / {thousands(MAX_MESSAGE)}
                </span>
              </div>
            )}
          </div>
          <button
            type="submit"
            className={`${c.primary} ${s.send}`}
            aria-label="Enviar"
            disabled={!!blocked || sending || tooLong || !draft.trim()}
          >
            <SendIcon />
          </button>
        </form>
      </section>
    </div>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

const SendIcon = () => (
  <svg {...icon} width={18} height={18} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 13V3.5M4 7.5 8 3.5l4 4" />
  </svg>
);

const NewIcon = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinejoin="round">
    <path d="M3 13l1-3 6.5-6.5a1.4 1.4 0 0 1 2 2L6 12l-3 1z" />
  </svg>
);

const ChevronDown = () => (
  <svg {...icon} width={14} height={14} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>
);

const ChevronUp = () => (
  <svg {...icon} width={14} height={14} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 9.5 8 6l3.5 3.5" />
  </svg>
);

const ChatIcon = () => (
  <svg {...icon} width={28} height={28} strokeWidth={1.3} strokeLinejoin="round">
    <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
  </svg>
);

const LockIcon = () => (
  <svg {...icon} width={26} height={26} strokeWidth={1.3}>
    <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

const LockSmall = () => (
  <svg {...icon} width={13} height={13} strokeWidth={1.4}>
    <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);

const ClockIcon = () => (
  <svg {...icon} width={14} height={14} strokeWidth={1.4} strokeLinecap="round">
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 5v3.2l2 1.2" />
  </svg>
);
