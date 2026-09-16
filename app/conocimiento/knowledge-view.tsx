"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { DocumentSummary } from "../../lib/kb/service";
import { call } from "../call";
import c from "../config.module.css";
import { deleteItemAction, documentTextAction, saveEntryAction, uploadDocumentAction } from "./actions";
import s from "./knowledge.module.css";

interface Entry {
  id: string;
  title: string;
  content: string;
  updatedAt: Date;
}

interface Props {
  entries: Entry[];
  documents: DocumentSummary[];
  pending: number;
  hasKey: boolean;
  maxDocuments: number;
  maxFileBytes: number;
}

const ACCEPT = ".pdf,.docx,.txt";
const KINDS: Record<string, string> = { pdf: "PDF", docx: "Word", txt: ".txt" };
const STATUS: Record<DocumentSummary["status"], { label: string; className: string }> = {
  procesando: { label: "Procesando…", className: s.pillMuted },
  listo: { label: "Listo", className: c.pillOk },
  no_se_pudo_leer: { label: "No se pudo leer", className: s.pillErr },
};

const day = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "short" });
const kindOfName = (name: string) => KINDS[name.split(".").pop()?.toLowerCase() ?? ""] ?? "Documento";

type Panel =
  | { kind: "entry"; entry?: Entry }
  | { kind: "document"; document: DocumentSummary }
  | null;

export function KnowledgeView({ entries, documents, pending, hasKey, maxDocuments, maxFileBytes }: Props) {
  const [panel, setPanel] = useState<Panel>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: "entry" | "document"; id: string; name: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ title?: string; content?: string; form?: string }>({});
  const [docText, setDocText] = useState<{ loading: boolean; text: string | null; error?: string }>({ loading: false, text: null });
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const panelRef = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const openDocumentId = useRef<string | null>(null);

  useEffect(() => {
    if (panel) panelRef.current?.showModal();
    else panelRef.current?.close();
  }, [panel]);

  useEffect(() => {
    if (confirm) confirmRef.current?.showModal();
    else confirmRef.current?.close();
  }, [confirm]);

  const atLimit = documents.length >= maxDocuments;

  function openEntry(entry?: Entry) {
    setErrors({});
    setMenuOpen(false);
    setPanel({ kind: "entry", entry });
  }

  function openDocument(document: DocumentSummary) {
    setPanel({ kind: "document", document });
    setDocText({ loading: document.status === "listo", text: null });
    openDocumentId.current = document.id;
    if (document.status !== "listo") return;
    call(() => documentTextAction(document.id), { ok: false, error: "No pudimos mostrar el texto. Intenta de nuevo." } as const).then(
      (result) => {
        if (openDocumentId.current !== document.id) return;
        setDocText(result.ok ? { loading: false, text: result.text } : { loading: false, text: null, error: result.error });
      },
    );
  }

  function chooseFile() {
    setMenuOpen(false);
    setNotice(null);
    fileRef.current?.click();
  }

  function upload(file: File) {
    // El servidor valida lo mismo, pero un archivo de más de 4,5 MB ni siquiera le llega: se rechaza aquí con el motivo.
    const error = !/\.(pdf|docx|txt)$/i.test(file.name)
      ? "Solo se aceptan documentos PDF, Word (.docx) y .txt."
      : file.size > maxFileBytes
        ? "El documento pesa más de 4 MB."
        : null;
    if (error) return setNotice(`No se subió “${file.name}”. ${error}`);

    setUploading(file.name);
    const form = new FormData();
    form.set("file", file);
    startSaving(async () => {
      const result = await call(() => uploadDocumentAction(form), {
        ok: false,
        error: "No pudimos subir el documento. Revisa tu conexión e intenta de nuevo.",
      });
      setUploading(null);
      setNotice(result.ok ? null : `No se subió “${file.name}”. ${result.error}`);
    });
  }

  function saveEntry(form: HTMLFormElement) {
    const data = new FormData(form);
    const entry = panel?.kind === "entry" ? panel.entry : undefined;
    startSaving(async () => {
      const result = await call(
        () =>
          saveEntryAction({
            id: entry?.id,
            title: String(data.get("title") ?? ""),
            content: String(data.get("content") ?? ""),
          }),
        { ok: false, errors: { form: "No pudimos guardar. Tu texto sigue aquí; intenta de nuevo." } } as const,
      );
      if (result.ok) {
        setPanel(null);
        setErrors({});
      } else {
        setErrors(result.errors);
      }
    });
  }

  function remove() {
    if (!confirm) return;
    const target = confirm;
    startSaving(async () => {
      const result = await call(() => deleteItemAction(target.kind, target.id), {
        ok: false,
        error: "No pudimos eliminarlo. Revisa tu conexión e intenta de nuevo.",
      });
      setConfirm(null);
      if (!result.ok) setNotice(result.error ?? null);
      else setPanel(null);
    });
  }

  const summary = `${entries.length === 1 ? "1 texto" : `${entries.length} textos`} · ${documents.length} de ${maxDocuments} documentos`;
  const isEmpty = entries.length === 0 && documents.length === 0 && !uploading;

  return (
    <div className={c.page}>
      <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) upload(file);
      }} />

      <header className={c.header}>
        <div className={c.titles}>
          <h1>Lo que sabe tu chatbot</h1>
          <p className={c.subtitle}>Responde solo con esta información. Si algo no está aquí, dirá que va a consultar.</p>
          <p className={s.privacy}>
            <ShieldIcon /> No incluyas datos personales de tus clientes.
          </p>
        </div>
        {!isEmpty && (
          <div className={s.addWrap}>
            <button type="button" className={`${c.primary} ${s.desktopOnly}`} onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
              <PlusIcon /> Agregar <ChevronDown />
            </button>
            {menuOpen && (
              <div className={s.menu}>
                <button type="button" className={s.menuItem} onClick={() => openEntry()}>
                  <span className={s.ico}><TextIcon /></span>
                  <span>
                    <strong>Escribir un texto</strong>
                    <span className={s.menuHint}>Horarios, precios, políticas…</span>
                  </span>
                </button>
                <button type="button" className={s.menuItem} onClick={chooseFile} disabled={atLimit}>
                  <span className={s.ico}><UploadIcon /></span>
                  <span>
                    <strong>Subir un documento</strong>
                    <span className={s.menuHint}>{atLimit ? `Llegaste al máximo de ${maxDocuments}` : "PDF, Word o .txt, hasta 4 MB"}</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {notice && (
        <div className={`${c.notice} ${s.noticeErr}`} role="alert">
          <span>{notice}</span>
          <button type="button" className={s.dismiss} aria-label="Cerrar aviso" onClick={() => setNotice(null)}>
            <CloseIcon />
          </button>
        </div>
      )}

      {pending > 0 && (
        <div className={c.notice}>
          {hasKey ? (
            <span>Parte de la información se está preparando para que el bot la use. Vuelve a cargar la página en un momento.</span>
          ) : (
            <span>
              Tu chatbot todavía no puede usar esta información: falta la API key en <Link href="/">Tu chatbot</Link>. Apenas la configures, se prepara sola.
            </span>
          )}
        </div>
      )}

      {atLimit && (
        <div className={c.notice}>
          <span>Llegaste al máximo de {maxDocuments} documentos. Para subir otro, elimina uno que ya no uses. Puedes seguir escribiendo textos.</span>
        </div>
      )}

      {isEmpty ? (
        <section className={s.empty}>
          <span className={s.emptyIcon}><BookIcon /></span>
          <h2>Enséñale a tu chatbot sobre tu negocio</h2>
          <p>Escribe tus horarios, precios o políticas, o sube documentos que ya tengas: un menú, una lista de precios.</p>
          <div className={s.emptyActions}>
            <button type="button" className={c.primary} onClick={() => openEntry()}>
              <TextIcon /> Escribir un texto
            </button>
            <button type="button" className={c.secondary} onClick={chooseFile}>
              <UploadIcon /> Subir un documento
            </button>
          </div>
          <span className={c.help}>PDF, Word (.docx) o .txt, hasta 4 MB.</span>
        </section>
      ) : (
        <section className={s.list}>
          <h2 className={s.listHeader}>{summary}</h2>
          {entries.map((entry) => (
            <Row
              key={entry.id}
              icon={<TextIcon />}
              title={entry.title}
              meta={`Texto · actualizado el ${day.format(entry.updatedAt)}`}
              onClick={() => openEntry(entry)}
            />
          ))}
          {uploading && <Row icon={<FileIcon />} title={uploading} meta="Subiendo…" status={STATUS.procesando} />}
          {documents.map((document) => (
            <Row
              key={document.id}
              icon={<FileIcon />}
              title={document.name}
              meta={document.error ?? `${kindOfName(document.name)} · subido el ${day.format(document.createdAt)}`}
              metaError={!!document.error}
              status={STATUS[document.status]}
              onClick={() => openDocument(document)}
            />
          ))}
        </section>
      )}

      {!isEmpty && (
        <div className={s.mobileBar}>
          <button type="button" className={c.primary} onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}>
            <PlusIcon /> Agregar
          </button>
        </div>
      )}

      <dialog ref={panelRef} className={s.panel} onClose={() => setPanel(null)}>
        {panel?.kind === "entry" && (
          <form
            className={s.panelBody}
            onSubmit={(e) => {
              e.preventDefault();
              saveEntry(e.currentTarget);
            }}
          >
            <div className={s.panelHead}>
              <div>
                <h2>{panel.entry ? panel.entry.title : "Nuevo texto"}</h2>
                <span className={c.help}>El bot usará este texto para responder.</span>
              </div>
              <button type="button" className={s.dismiss} aria-label="Cerrar" onClick={() => setPanel(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className={s.panelContent}>
              <div className={c.field}>
                <label className={c.label} htmlFor="title">Título</label>
                <input
                  id="title"
                  name="title"
                  className={c.input}
                  defaultValue={panel.entry?.title ?? ""}
                  placeholder="Ej.: Horarios"
                  aria-invalid={!!errors.title}
                />
                {errors.title && <span className={c.err}>{errors.title}</span>}
              </div>
              <div className={`${c.field} ${s.grow}`}>
                <label className={c.label} htmlFor="content">Contenido</label>
                <textarea
                  id="content"
                  name="content"
                  className={`${c.textarea} ${s.grow}`}
                  defaultValue={panel.entry?.content ?? ""}
                  placeholder="Ej.: Abrimos de lunes a viernes de 7:00 a 19:00 y los sábados de 8:00 a 14:00."
                  aria-invalid={!!errors.content}
                />
                {errors.content && <span className={c.err}>{errors.content}</span>}
              </div>
              {errors.form && <span className={c.err} role="alert">{errors.form}</span>}
            </div>
            <div className={s.panelFoot}>
              {panel.entry ? (
                <button
                  type="button"
                  className={s.danger}
                  onClick={() => setConfirm({ kind: "entry", id: panel.entry!.id, name: panel.entry!.title })}
                >
                  Eliminar
                </button>
              ) : (
                <span />
              )}
              <div className={s.panelActions}>
                <button type="button" className={c.secondary} onClick={() => setPanel(null)}>Cancelar</button>
                <button type="submit" className={c.primary} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</button>
              </div>
            </div>
          </form>
        )}

        {panel?.kind === "document" && (
          <div className={s.panelBody}>
            <div className={s.panelHead}>
              <div>
                <h2>{panel.document.name}</h2>
                <div className={s.docMeta}>
                  <span className={`${c.pill} ${STATUS[panel.document.status].className}`}>{STATUS[panel.document.status].label}</span>
                  <span className={c.help}>{kindOfName(panel.document.name)} · subido el {day.format(panel.document.createdAt)}</span>
                </div>
              </div>
              <button type="button" className={s.dismiss} aria-label="Cerrar" onClick={() => setPanel(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className={s.panelContent}>
              {panel.document.status === "no_se_pudo_leer" ? (
                <>
                  <div className={`${c.notice} ${s.noticeErr}`}>{panel.document.error}</div>
                  <span className={c.help}>
                    El bot no usa este documento. Elimínalo y escribe su contenido como texto, o sube una versión con texto seleccionable.
                  </span>
                </>
              ) : panel.document.status === "procesando" ? (
                <span className={c.help}>Estamos leyendo el documento. Vuelve a cargar la página en un momento.</span>
              ) : (
                <>
                  <span className={c.help}>
                    Este es el texto que el bot leyó del documento. Si falta algo, súbelo de nuevo o escríbelo como texto.
                  </span>
                  <div className={`${c.textarea} ${s.extracted}`}>
                    {docText.loading ? "Cargando…" : (docText.error ?? docText.text ?? "")}
                  </div>
                </>
              )}
            </div>
            <div className={s.panelFoot}>
              <button
                type="button"
                className={s.danger}
                onClick={() => setConfirm({ kind: "document", id: panel.document.id, name: panel.document.name })}
              >
                Eliminar documento
              </button>
              <div className={s.panelActions}>
                {panel.document.status === "no_se_pudo_leer" ? (
                  <button type="button" className={c.primary} onClick={() => openEntry()}>
                    <TextIcon /> Escribir como texto
                  </button>
                ) : (
                  <button type="button" className={c.secondary} onClick={() => setPanel(null)}>Cerrar</button>
                )}
              </div>
            </div>
          </div>
        )}
      </dialog>

      <dialog ref={confirmRef} className={c.dialog} onClose={() => setConfirm(null)}>
        <h2>¿Eliminar “{confirm?.name}”?</h2>
        <p>El bot dejará de usar esta información para responder. No se puede deshacer.</p>
        <div className={c.dialogActions}>
          <button type="button" className={c.secondary} onClick={() => setConfirm(null)}>Cancelar</button>
          <button type="button" className={c.dangerButton} onClick={remove} disabled={saving}>
            {saving ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      </dialog>
    </div>
  );
}

function Row({
  icon,
  title,
  meta,
  status,
  metaError,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  meta: string;
  status?: { label: string; className: string };
  metaError?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className={s.ico}>{icon}</span>
      <span className={s.rowText}>
        <span className={s.rowTitle}>{title}</span>
        <span className={metaError ? s.rowMetaError : s.rowMeta}>{meta}</span>
        {status && <span className={`${c.pill} ${status.className} ${s.pillMobile}`}>{status.label}</span>}
      </span>
      {status && <span className={`${c.pill} ${status.className} ${s.pillDesktop}`}>{status.label}</span>}
      {onClick && <ChevronRight />}
    </>
  );
  return onClick ? (
    <button type="button" className={s.row} onClick={onClick} aria-label={status ? `${title}, ${status.label}` : title}>
      {content}
    </button>
  ) : (
    <div className={s.row}>{content}</div>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

const TextIcon = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinecap="round">
    <path d="M3.5 4h9M3.5 7h9M3.5 10h6M3.5 13h4" />
  </svg>
);

const FileIcon = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinejoin="round">
    <path d="M9 2.5H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V6L9 2.5z" />
    <path d="M9 2.5V6h3.5" />
  </svg>
);

const PlusIcon = () => (
  <svg {...icon} strokeWidth={1.7} strokeLinecap="round">
    <path d="M8 3.5v9M3.5 8h9" />
  </svg>
);

const UploadIcon = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 11V3.5M5 6.5l3-3 3 3" />
    <path d="M3 11.5v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" />
  </svg>
);

const ChevronDown = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>
);

const ChevronRight = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className={s.chevron}>
    <path d="M6.5 4.5 10 8l-3.5 3.5" />
  </svg>
);

const CloseIcon = () => (
  <svg {...icon} width={18} height={18} strokeWidth={1.5} strokeLinecap="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

const ShieldIcon = () => (
  <svg {...icon} strokeWidth={1.5} strokeLinejoin="round">
    <path d="M8 2 3.5 3.75v3.5c0 3 2 5 4.5 6.25 2.5-1.25 4.5-3.25 4.5-6.25v-3.5L8 2z" />
  </svg>
);

const BookIcon = () => (
  <svg {...icon} width={28} height={28} strokeWidth={1.3} strokeLinejoin="round">
    <path d="M3 3.5h4a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0-1.5-1.5H3v-7.5zM13 3.5H9" />
    <path d="M13 3.5v7.5H10.5A1.5 1.5 0 0 0 9 12.5" />
  </svg>
);
