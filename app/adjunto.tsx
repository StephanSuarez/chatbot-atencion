"use client";

import s from "./adjunto.module.css";

// Los adjuntos (010) se ven igual en el chat del cliente y en el detalle del equipo, así que viven aquí
// en vez de copiarse en las dos pantallas.

/** Lo que hace falta para mostrar un adjunto, venga del servidor o del archivo recién elegido. */
export interface Adjunto {
  name: string;
  category: string;
  sizeBytes: number;
  url: string;
}

export const peso = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const extension = (name: string) => (name.split(".").pop() ?? "").toUpperCase().slice(0, 4);

/**
 * El mensaje recién enviado todavía no existe en el servidor, así que se muestra desde el archivo local.
 * ponytail: la URL creada vive lo que dure la página; se liberan al empezar otra conversación.
 */
export const localAdjunto = (file: File): Adjunto => ({
  name: file.name,
  category: file.type.startsWith("image/") ? "imagen" : file.type.startsWith("audio/") ? "audio" : "documento",
  sizeBytes: file.size,
  url: URL.createObjectURL(file),
});

/** La ficha que llega con un mensaje, ya guardada: los bytes se piden a su propia ruta. */
export const deEntrada = (a: { id: string; name: string; category: string; sizeBytes: number }): Adjunto => ({
  name: a.name,
  category: a.category,
  sizeBytes: a.sizeBytes,
  url: `/api/adjuntos/${a.id}`,
});

const clases = (...nombres: (string | false | undefined)[]) => nombres.filter(Boolean).join(" ");

/** La imagen se ve, el audio se escucha y el documento se descarga con su nombre (FR-007, FR-008). */
export function VistaAdjunto({
  adjunto,
  conTexto,
  sobreAcento,
}: {
  adjunto: Adjunto;
  conTexto: boolean;
  /** Dentro de una burbuja de color: el documento se aclara para que se lea encima. */
  sobreAcento?: boolean;
}) {
  const margen = conTexto && s.conTexto;

  if (adjunto.category === "imagen") {
    // Es un archivo del cliente servido por nuestra propia ruta, no un recurso del sitio, y la vista previa
    // local llega como URL blob:, que next/image no admite.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={clases(s.imagen, margen)} src={adjunto.url} alt={adjunto.name} />;
  }

  if (adjunto.category === "audio") {
    return <audio className={clases(s.audio, margen)} controls src={adjunto.url} />;
  }

  return (
    <a
      className={clases(s.doc, margen, sobreAcento && s.docSobreAcento)}
      href={adjunto.url}
      download={adjunto.name}
      title={adjunto.name}
    >
      <span className={clases(s.icono, sobreAcento && s.iconoSobreAcento)}>{extension(adjunto.name)}</span>
      <span className={s.texto}>
        <b>{adjunto.name}</b>
        <span>{peso(adjunto.sizeBytes)}</span>
      </span>
    </a>
  );
}

/** El archivo elegido, antes de enviarlo. Igual en las dos pantallas. */
export function ChipArchivo({
  file,
  preview,
  sending,
  onRemove,
}: {
  file: File;
  preview: string | null;
  sending: boolean;
  onRemove: () => void;
}) {
  return (
    <div className={clases(s.chip, sending && s.chipEnviando)}>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.chipMini} src={preview} alt="" />
      ) : (
        <span className={s.icono}>{extension(file.name)}</span>
      )}
      <span className={s.chipNombre}>{file.name}</span>
      <span className={s.chipPeso}>{peso(file.size)}</span>
      <button
        type="button"
        className={s.chipQuitar}
        aria-label={`Quitar ${file.name}`}
        disabled={sending}
        onClick={onRemove}
      >
        ×
      </button>
    </div>
  );
}

export const ClipIcon = () => (
  <svg
    width={18}
    height={18}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M13.5 7.5 8.2 12.8a3 3 0 0 1-4.3-4.3l5.4-5.3a2 2 0 0 1 2.8 2.8l-5.4 5.4a1 1 0 0 1-1.4-1.4l5-5" />
  </svg>
);
