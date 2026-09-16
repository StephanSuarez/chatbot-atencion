"use client";

import { useEffect, useRef, useState } from "react";
import type { FieldErrors, PublicConfig } from "../lib/config-service";
import type { GoogleConnection } from "../lib/google/config";
import { call } from "./call";
import { loadModelsAction, saveAction } from "./actions";
import { disconnectGoogleAction, saveAgendaAction, startGoogleConnectionAction } from "./google-actions";
import s from "./config.module.css";
import { Tabs } from "./tabs";

interface Props {
  initial: PublicConfig;
  pending: number;
  google: GoogleConnection | null;
  providers: { id: string; name: string }[];
  rules: string[];
  defaultPrompt: string;
  maxPrompt: number;
}

const KEY_HELP_URL: Record<string, string> = {
  openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys",
};

export const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const joinEs = (items: string[]) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

const DAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];
const NOTICE_OPTIONS = [0, 1, 2, 4, 12, 24, 48];
// Con lo que vuelve el callback de Google (app/api/google/callback/route.ts).
const GOOGLE_RESULTS: Record<string, { text: string; good?: boolean }> = {
  conectado: { text: "Listo: tu calendario quedó conectado. Ahora define el horario de atención.", good: true },
  cancelado: { text: "No se conectó ninguna cuenta: cancelaste la autorización en Google." },
  estado_invalido: { text: "No pudimos verificar la conexión. Vuelve a intentarlo desde este botón." },
  sin_credenciales: { text: "Faltan las credenciales de Google de la aplicación." },
  sin_permiso: { text: "Google no concedió el permiso necesario. Vuelve a conectar y acepta el acceso al calendario." },
  fallo: { text: "Google no respondió. Intenta conectar de nuevo en unos minutos." },
};

// Lo que dejó el callback en la URL. Se lee al crear el estado, no en un efecto, y se limpia al montar.
const resultFromUrl = (): { text: string; good?: boolean } | null => {
  if (typeof window === "undefined") return null;
  const result = new URLSearchParams(window.location.search).get("google");
  return result ? (GOOGLE_RESULTS[result] ?? null) : null;
};

export function ConfigForm({ pending, initial, providers, rules, defaultPrompt, maxPrompt, google }: Props) {
  const [saved, setSaved] = useState(initial);
  const [companyName, setCompanyName] = useState(initial.companyName);
  const [prompt, setPrompt] = useState(initial.prompt);
  const [provider, setProvider] = useState(initial.provider ?? "");
  const [model, setModel] = useState(initial.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [keyVerified, setKeyVerified] = useState(false);
  const [modelsErrors, setModelsErrors] = useState<FieldErrors>({});
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(false);
  const restoreDialog = useRef<HTMLDialogElement>(null);
  // Agendamiento con Google (006): vive en esta misma pantalla, junto al proveedor y la API key.
  const [agenda, setAgenda] = useState(
    google?.agenda ?? { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", slotMinutes: 30, minNoticeHours: 2 },
  );
  const [agendaNotice, setAgendaNotice] = useState<string | null>(null);
  const [googleResult, setGoogleResult] = useState(resultFromUrl);
  const [working, setWorking] = useState(false);

  const providerName = (id: string | null) => providers.find((p) => p.id === id)?.name ?? "";
  const sameProvider = provider === (saved.provider ?? "");
  const hasSavedKey = sameProvider && !!saved.apiKeyMask;
  const showKeyInput = !hasSavedKey || replacingKey;
  // Hay proveedor guardado pero la key no se pudo descifrar (ENCRYPTION_KEY cambió).
  const keyUnreadable = sameProvider && !!saved.provider && !saved.apiKeyMask;
  const dirty =
    companyName !== saved.companyName ||
    prompt !== saved.prompt ||
    !sameProvider ||
    model !== (saved.model ?? "") ||
    apiKey !== "";

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(false), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function chooseProvider(id: string) {
    setProvider(id);
    setModel(id === saved.provider ? (saved.model ?? "") : "");
    setApiKey("");
    setReplacingKey(false);
    setModels(null);
    setKeyVerified(false);
    setModelsErrors({});
  }

  async function loadModels() {
    setLoadingModels(true);
    setModelsErrors({});
    const result = await loadModelsAction(provider, apiKey);
    setLoadingModels(false);
    if (result.ok) {
      setModels(result.models);
      setKeyVerified(apiKey.trim() !== "");
    } else {
      setModelsErrors(result.errors);
    }
  }

  async function save() {
    setSaving(true);
    const result = await saveAction({ companyName, prompt, provider, model, apiKey });
    setSaving(false);
    if (!result.ok) return setErrors(result.errors);
    setSaved(result.config);
    setCompanyName(result.config.companyName);
    setApiKey("");
    setReplacingKey(false);
    setKeyVerified(false);
    setErrors({});
    setModelsErrors({});
    setToast(true);
  }

  const keyError = errors.apiKey ?? modelsErrors.apiKey;
  const fieldErrorCount = Object.keys(errors).filter((f) => f !== "form").length;
  const modelEnabled = models !== null || (hasSavedKey && !replacingKey);

  const saveButton = (
    <button type="submit" className={s.primary} disabled={saving}>
      {saving ? "Guardando…" : "Guardar"}
    </button>
  );

  // El aviso ya se leyó al crear el estado; aquí solo se limpia la URL para que no reaparezca al recargar.
  useEffect(() => {
    if (window.location.search.includes("google=")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function connectGoogle() {
    setGoogleResult(null);
    setWorking(true);
    const result = await call(() => startGoogleConnectionAction(), {
      ok: false as const,
      error: "No pudimos empezar la conexión. Intenta de nuevo.",
    });
    if (result.ok) window.location.href = result.url;
    else {
      setGoogleResult({ text: result.error });
      setWorking(false);
    }
  }

  async function disconnectGoogle() {
    setGoogleResult(null);
    setWorking(true);
    const result = await call(() => disconnectGoogleAction(), { ok: false, error: "No pudimos desconectar." });
    setGoogleResult(result.ok ? { text: "Cuenta desconectada. El chatbot dejó de agendar citas.", good: true } : { text: result.error! });
    setWorking(false);
  }

  async function saveAgendaSettings() {
    setAgendaNotice(null);
    setWorking(true);
    const result = await call(() => saveAgendaAction(agenda), { ok: false, error: "No pudimos guardar el horario." });
    setAgendaNotice(result.ok ? "Horario guardado." : result.error!);
    setWorking(false);
  }

  const toggleDay = (day: number) =>
    setAgenda((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((d) => d !== day) : [...current.days, day].sort(),
    }));

  const agendaState = !google ? "off" : google.agenda ? "on" : "warn";

  return (
    <>
      <Tabs active="config" pending={pending} />
      <form
        className={s.page}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
      <header className={s.header}>
        <div className={s.titles}>
          <h1>Tu chatbot</h1>
          <p className={s.subtitle}>Cómo se presenta, cómo habla y con qué inteligencia artificial responde.</p>
          {saved.complete ? (
            <span className={`${s.pill} ${s.pillOk}`}>
              <CheckIcon /> Completa
            </span>
          ) : (
            <span className={`${s.pill} ${s.pillWarn}`}>
              <InfoIcon /> Incompleta · falta {joinEs(saved.missing)}
            </span>
          )}
        </div>
        <div className={s.actions}>
          {errors.form ? (
            <span className={s.errText} role="alert">{errors.form}</span>
          ) : fieldErrorCount > 0 ? (
            <span className={s.errText} role="alert">
              No se guardó: revisa {fieldErrorCount === 1 ? "1 campo" : `${fieldErrorCount} campos`}
            </span>
          ) : (
            dirty && <span className={s.muted}>Cambios sin guardar</span>
          )}
          <span className={s.desktopOnly}>{saveButton}</span>
        </div>
      </header>

      <div className={s.grid}>
        <section className={s.card}>
          <h2>Tu empresa</h2>
          <div className={s.field}>
            <label htmlFor="companyName" className={s.label}>Nombre de la empresa</label>
            <input
              id="companyName"
              className={s.input}
              placeholder="Ej.: Café Aurora"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              aria-invalid={!!errors.companyName}
            />
            {errors.companyName && <FieldError>{errors.companyName}</FieldError>}
          </div>

          <div className={s.field}>
            <div className={s.row}>
              <label htmlFor="prompt" className={s.label}>Cómo debe hablar</label>
              <button type="button" className={s.link} onClick={() => restoreDialog.current?.showModal()}>
                Volver al texto original
              </button>
            </div>
            <textarea
              id="prompt"
              className={s.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              aria-invalid={!!errors.prompt}
            />
            <div className={s.row}>
              {errors.prompt ? <FieldError>{errors.prompt}</FieldError> : <span />}
              <span className={prompt.length > maxPrompt ? s.counterOver : s.counter}>
                {thousands(prompt.length)} / {thousands(maxPrompt)}
              </span>
            </div>
          </div>

          <div className={s.rules}>
            <div className={s.rulesTitle}>
              <LockIcon /> Siempre cumple, aunque el texto diga otra cosa
            </div>
            {rules.map((rule) => (
              <div key={rule} className={s.rule}>
                <CheckIcon /> <span>{rule}</span>
              </div>
            ))}
          </div>
        </section>

        <section className={s.card}>
          <h2>Inteligencia artificial</h2>
          <fieldset className={s.field}>
            <legend className={s.label}>Proveedor</legend>
            <div className={s.tiles}>
              {providers.map((p) => (
                <label key={p.id} className={provider === p.id ? `${s.tile} ${s.tileOn}` : s.tile}>
                  <input type="radio" name="provider" value={p.id} checked={provider === p.id} disabled={loadingModels} onChange={() => chooseProvider(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
            {errors.provider && <FieldError>{errors.provider}</FieldError>}
          </fieldset>

          <div className={s.field}>
            <div className={s.row}>
              <label htmlFor="apiKey" className={s.label}>API key</label>
              {KEY_HELP_URL[provider] && (
                <a href={KEY_HELP_URL[provider]} target="_blank" rel="noopener noreferrer" className={s.link}>
                  ¿Dónde la consigo?
                </a>
              )}
            </div>
            {showKeyInput ? (
              <div className={s.keyRow}>
                <input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  className={s.input}
                  placeholder={provider ? `Pega aquí tu API key de ${providerName(provider)}` : "Pega aquí tu API key"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setKeyVerified(false);
                  }}
                  aria-invalid={!!keyError}
                />
                <button type="button" className={s.secondary} onClick={loadModels} disabled={!provider || loadingModels}>
                  {loadingModels ? "Verificando…" : "Cargar modelos"}
                </button>
              </div>
            ) : (
              <div className={`${s.input} ${s.masked}`}>
                <span>{saved.apiKeyMask}</span>
                <button type="button" className={s.link} onClick={() => setReplacingKey(true)}>
                  Reemplazar
                </button>
              </div>
            )}
            {keyError ? (
              <FieldError>{keyError}</FieldError>
            ) : modelsErrors.form ? (
              <div className={s.notice}>
                <span>
                  {modelsErrors.form}{" "}
                  <button type="button" className={s.noticeLink} onClick={loadModels}>Reintentar</button>
                </span>
              </div>
            ) : keyVerified ? (
              <span className={s.ok}><CheckIcon /> Key verificada</span>
            ) : keyUnreadable && showKeyInput ? (
              <div className={s.notice}>No pudimos leer la key guardada. Vuelve a ingresarla para que tu chatbot funcione.</div>
            ) : !sameProvider && saved.apiKeyMask ? (
              <span className={s.help}>
                Ingresa una key de {providerName(provider)}. La de {providerName(saved.provider)} no sirve con este proveedor.
              </span>
            ) : (
              showKeyInput && <span className={s.help}>La verificamos con el proveedor. Después solo verás los últimos 4 caracteres.</span>
            )}
          </div>

          <div className={s.field}>
            <label htmlFor="model" className={modelEnabled ? s.label : `${s.label} ${s.labelOff}`}>Modelo</label>
            {/* ponytail: búsqueda con <datalist> nativo; si se queda corto con 445 modelos, un combobox propio. */}
            <input
              id="model"
              list="models"
              className={s.input}
              disabled={!modelEnabled || loadingModels}
              placeholder={
                loadingModels ? "Cargando modelos…" : models ? `Buscar entre ${models.length} modelos` : "Primero carga los modelos"
              }
              value={model}
              onChange={(e) => setModel(e.target.value)}
              onFocus={() => models === null && hasSavedKey && !replacingKey && loadModels()}
              aria-invalid={!!errors.model}
            />
            <datalist id="models">{models?.map((m) => <option key={m} value={m} />)}</datalist>
            {errors.model && <FieldError>{errors.model}</FieldError>}
          </div>
        </section>

        <section className={s.card}>
          <div className={s.agendaHead}>
            <h2>Agendamiento de citas</h2>
            <span
              className={
                agendaState === "on"
                  ? `${s.agendaState} ${s.agendaStateOn}`
                  : agendaState === "warn"
                    ? `${s.agendaState} ${s.agendaStateWarn}`
                    : s.agendaState
              }
            >
              <i className={s.agendaDot} />
              {agendaState === "on" ? "Activo" : agendaState === "warn" ? "Falta el horario" : "Apagado"}
            </span>
          </div>

          {googleResult && (
            <div className={googleResult.good ? `${s.notice} ${s.noticeOk}` : s.notice} role="status">
              <span>{googleResult.text}</span>
            </div>
          )}

          {google ? (
            <>
              <div className={s.account}>
                <span className={s.accountAvatar}>{google.email.slice(0, 1).toUpperCase()}</span>
                <span className={s.accountInfo}>
                  <strong>{google.email}</strong>
                  <span>Calendario principal</span>
                </span>
                <button type="button" className={s.accountAction} onClick={disconnectGoogle} disabled={working}>
                  Desconectar
                </button>
              </div>

              <fieldset className={s.field}>
                <legend className={s.label}>Días que atiendes</legend>
                <div className={s.days}>
                  {DAY_LABELS.map((label, day) => (
                    <button
                      key={day}
                      type="button"
                      className={agenda.days.includes(day) ? `${s.day} ${s.dayOn}` : s.day}
                      aria-pressed={agenda.days.includes(day)}
                      aria-label={DAY_NAMES[day]}
                      onClick={() => toggleDay(day)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className={s.agendaFields}>
                <div className={s.field}>
                  <label htmlFor="agendaStart" className={s.label}>Desde</label>
                  <input
                    id="agendaStart"
                    type="time"
                    className={s.input}
                    value={agenda.start}
                    onChange={(e) => setAgenda({ ...agenda, start: e.target.value })}
                  />
                </div>
                <div className={s.field}>
                  <label htmlFor="agendaEnd" className={s.label}>Hasta</label>
                  <input
                    id="agendaEnd"
                    type="time"
                    className={s.input}
                    value={agenda.end}
                    onChange={(e) => setAgenda({ ...agenda, end: e.target.value })}
                  />
                </div>
                <div className={s.field}>
                  <label htmlFor="agendaSlot" className={s.label}>Duración de la cita</label>
                  <select
                    id="agendaSlot"
                    className={s.input}
                    value={agenda.slotMinutes}
                    onChange={(e) => setAgenda({ ...agenda, slotMinutes: Number(e.target.value) })}
                  >
                    {SLOT_OPTIONS.map((minutes) => (
                      <option key={minutes} value={minutes}>{minutes} minutos</option>
                    ))}
                  </select>
                </div>
                <div className={s.field}>
                  <label htmlFor="agendaNotice" className={s.label}>Aviso mínimo</label>
                  <select
                    id="agendaNotice"
                    className={s.input}
                    value={agenda.minNoticeHours}
                    onChange={(e) => setAgenda({ ...agenda, minNoticeHours: Number(e.target.value) })}
                  >
                    {NOTICE_OPTIONS.map((hours) => (
                      <option key={hours} value={hours}>{hours === 0 ? "Sin aviso previo" : `${hours} horas`}</option>
                    ))}
                  </select>
                </div>
              </div>

              <span className={s.help}>
                Con un aviso mínimo de {agenda.minNoticeHours} horas, nadie puede pedir una cita para dentro de menos tiempo.
              </span>

              <div className={s.actions}>
                <button type="button" className={s.secondary} onClick={saveAgendaSettings} disabled={working}>
                  {working ? "Guardando…" : "Guardar horario"}
                </button>
                {agendaNotice && <span className={s.agendaNotice}>{agendaNotice}</span>}
              </div>
            </>
          ) : (
            <>
              <span className={s.help}>
                Conecta el calendario de tu empresa y el chatbot agendará citas en él. Solo pedimos permiso para ver la
                disponibilidad y crear eventos; puedes desconectarlo cuando quieras.
              </span>
              <div className={s.actions}>
                <button type="button" className={s.primary} onClick={connectGoogle} disabled={working}>
                  {working ? "Abriendo Google…" : "Conectar con Google"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>

      <div className={s.mobileBar}>{saveButton}</div>

      {toast && (
        <div className={s.toast} role="status">
          <CheckIcon /> Cambios guardados
        </div>
      )}

      <dialog ref={restoreDialog} className={s.dialog}>
        <h2>¿Volver al texto original?</h2>
        <p>Tu texto actual se reemplaza por el texto por defecto. El cambio se aplica cuando guardes.</p>
        <div className={s.dialogActions}>
          <button type="button" className={s.secondary} onClick={() => restoreDialog.current?.close()}>
            Cancelar
          </button>
          <button
            type="button"
            className={s.primary}
            onClick={() => {
              setPrompt(defaultPrompt);
              restoreDialog.current?.close();
            }}
          >
            Volver al original
          </button>
        </div>
      </dialog>
      </form>
    </>
  );
}

function FieldError({ children }: { children: string }) {
  return (
    <span className={s.err} role="alert">
      <InfoIcon /> {children}
    </span>
  );
}

const icon = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

const InfoIcon = () => (
  <svg {...icon} strokeWidth={1.5}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 4.75v3.75M8 10.75v.5" strokeLinecap="round" />
  </svg>
);

const CheckIcon = () => (
  <svg {...icon} strokeWidth={1.6}>
    <path d="M3.5 8.5l3 3 6-6.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LockIcon = () => (
  <svg {...icon} strokeWidth={1.5}>
    <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
);
