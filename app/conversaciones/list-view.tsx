"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ConversationSummary, TypeFilter } from "../../lib/conversations/service";
import { call } from "../call";
import c from "../config.module.css";
import { deleteConversationAction } from "./actions";
import s from "./conversaciones.module.css";
import { Detail } from "./detail";
import { PRESET_LABEL, type Preset } from "./range";

interface Filters {
  type: TypeFilter;
  preset: Preset;
  from: string;
  to: string;
}

// La fecha llega ya escrita desde el servidor (ver page.tsx).
type Row = ConversationSummary & { when: string };

interface Props {
  conversations: Row[];
  filters: Filters;
  companyName: string;
}

const TYPE_LABEL: Record<TypeFilter, string> = {
  todas: "Todas",
  derivadas: "Derivadas por el bot",
  sin_derivar: "Sin derivar",
};

const PRESETS: Preset[] = ["siempre", "hoy", "ayer", "7dias", "30dias", "personalizada"];

export function ConversationsView({ conversations, filters, companyName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [confirm, setConfirm] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, startWorking] = useTransition();
  const confirmRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (confirm) confirmRef.current?.showModal();
    else confirmRef.current?.close();
  }, [confirm]);

  const dateFilterOn = filters.preset !== "siempre";

  function apply(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    const query = new URLSearchParams();
    if (merged.type !== "todas") query.set("tipo", merged.type);
    if (merged.preset !== "siempre") query.set("fecha", merged.preset);
    if (merged.preset === "personalizada") {
      if (merged.from) query.set("desde", merged.from);
      if (merged.to) query.set("hasta", merged.to);
    }
    const search = query.toString();
    router.push(search ? `/conversaciones?${search}` : "/conversaciones");
  }

  function remove(conversation: Row) {
    startWorking(async () => {
      const result = await call(() => deleteConversationAction(conversation.id), {
        ok: false,
        error: "No pudimos contactar al servidor. Intenta de nuevo.",
      });
      setConfirm(null);
      if (!result.ok) setError(result.error ?? "No se pudo borrar.");
      else {
        if (conversation.id === selected) setSelected(undefined);
        router.refresh();
      }
    });
  }

  return (
    <div className={c.page}>
      <header className={c.header}>
        <div className={c.titles}>
          <h1>Conversaciones</h1>
          <p className={c.subtitle}>Todo lo que ha conversado tu chatbot. Las que esperan a una persona van primero.</p>
        </div>
      </header>

      {error && (
        <div className={`${c.notice} ${s.error}`} role="alert">
          <span>{error}</span>
        </div>
      )}

      <section className={s.panelWrap}>
        <div className={s.split}>
          <div className={selected ? `${s.listSide} ${s.hideOnMobile}` : s.listSide}>
            <div className={s.filters}>
              <label className={c.srOnly} htmlFor="tipo">Tipo de conversación</label>
              <select
                id="tipo"
                className={s.select}
                value={filters.type}
                onChange={(e) => apply({ type: e.target.value as TypeFilter })}
              >
                {(Object.keys(TYPE_LABEL) as TypeFilter[]).map((type) => (
                  <option key={type} value={type}>{TYPE_LABEL[type]}</option>
                ))}
              </select>
              <button
                type="button"
                className={dateFilterOn ? `${s.more} ${s.moreOn}` : s.more}
                aria-expanded={open}
                onClick={() => setOpen(!open)}
              >
                <FiltersIcon /> Filtros
              </button>
            </div>

            {open && (
              <div className={s.panel}>
                <div className={s.panelHead}>
                  <span>Fecha del último mensaje</span>
                  {dateFilterOn && (
                    <button type="button" className={s.clear} onClick={() => apply({ preset: "siempre" })}>
                      Limpiar
                    </button>
                  )}
                </div>
                <div className={s.chips}>
                  {PRESETS.filter((preset) => preset !== "siempre").map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={filters.preset === preset ? `${s.chip} ${s.chipOn}` : s.chip}
                      aria-pressed={filters.preset === preset}
                      onClick={() => apply({ preset })}
                    >
                      {PRESET_LABEL[preset]}
                    </button>
                  ))}
                </div>
                {filters.preset === "personalizada" && (
                  <div className={s.range}>
                    <label className={s.rangeField}>
                      <span>Desde</span>
                      <input type="date" className={s.date} value={filters.from} onChange={(e) => apply({ from: e.target.value })} />
                    </label>
                    <label className={s.rangeField}>
                      <span>Hasta</span>
                      <input type="date" className={s.date} value={filters.to} onChange={(e) => apply({ to: e.target.value })} />
                    </label>
                  </div>
                )}
              </div>
            )}

            {conversations.length === 0 ? (
              <div className={s.empty}>
                <span className={s.bigIcon}><ChatIcon /></span>
                {filters.type === "todas" && !dateFilterOn ? (
                  <>
                    <h2>Aún no hay conversaciones</h2>
                    <p>Cuando alguien escriba en «Probar», la conversación aparecerá aquí.</p>
                  </>
                ) : (
                  <>
                    <h2>Ninguna conversación con esos filtros</h2>
                    <p>Prueba con otro rango de fechas o con otro tipo.</p>
                  </>
                )}
              </div>
            ) : (
              <ul className={s.rows}>
                {conversations.map((conversation) => (
                  <li key={conversation.id} className={conversation.id === selected ? `${s.row} ${s.rowOn}` : s.row}>
                    <button type="button" className={s.rowButton} onClick={() => setSelected(conversation.id)}>
                      <div className={s.rowTop}>
                        <span className={s.rowTitle}>Conversación del {conversation.when}</span>
                        <div className={s.rowTags}>
                          {conversation.pending && <span className={s.tagPend}>Pendiente</span>}
                          {conversation.derived && <span className={s.tagDer}>Derivada</span>}
                          <span className={conversation.mode === "ia" ? s.tagIa : s.tagHuman}>
                            {conversation.mode === "ia" ? "Responde la IA" : "Respondes tú"}
                          </span>
                        </div>
                      </div>
                      <span className={s.rowMeta}>Chat de prueba</span>
                    </button>
                    <button
                      type="button"
                      className={s.trash}
                      aria-label={`Borrar la conversación del ${conversation.when}`}
                      disabled={conversation.pending || working}
                      title={conversation.pending ? "Primero respóndela: espera a una persona" : "Borrar conversación"}
                      onClick={() => {
                        setError(null);
                        setConfirm(conversation);
                      }}
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={selected ? s.detail : `${s.detail} ${s.hideOnMobile}`}>
            {selected ? (
              <Detail
                key={selected}
                id={selected}
                companyName={companyName}
                onBack={() => setSelected(undefined)}
                onGone={() => {
                  setSelected(undefined);
                  router.refresh();
                }}
                onChanged={() => router.refresh()}
              />
            ) : (
              <p className={s.pickOne}>Elige una conversación para leerla y responder.</p>
            )}
          </div>
        </div>
      </section>

      <dialog ref={confirmRef} className={c.dialog} onClose={() => setConfirm(null)}>
        {confirm && (
          <>
            <h2>¿Borrar esta conversación?</h2>
            <p className={c.help}>Se borran sus mensajes y las notas del bot. No se puede deshacer.</p>
            <div className={c.dialogActions}>
              <button type="button" className={c.secondary} onClick={() => setConfirm(null)} disabled={working}>
                Cancelar
              </button>
              <button type="button" className={c.dangerButton} onClick={() => remove(confirm)} disabled={working}>
                {working ? "Borrando…" : "Borrar"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

const icon = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

const FiltersIcon = () => (
  <svg {...icon} width={14} height={14} strokeWidth={1.5} strokeLinecap="round">
    <path d="M2 5h8M12.5 5H14M2 11h2.5M7 11h7" />
    <circle cx="11" cy="5" r="1.5" />
    <circle cx="5.75" cy="11" r="1.5" />
  </svg>
);

const TrashIcon = () => (
  <svg {...icon} width={15} height={15} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8M6.75 7v3.5M9.25 7v3.5" />
  </svg>
);

const ChatIcon = () => (
  <svg {...icon} width={26} height={26} strokeWidth={1.3} strokeLinejoin="round">
    <path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
  </svg>
);
