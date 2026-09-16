import { eq } from "drizzle-orm";
import { decryptApiKey, encryptApiKey } from "../crypto";
import { db } from "../db";
import { readEncryptionKey } from "../env";
import { chatbotConfig } from "../schema";
import type { GoogleCredentials } from "./client";

// Cuenta de Google conectada y horario de atención (plan 006 §5). El refresh token se guarda cifrado
// y nunca sale de este módulo en claro.

export interface Agenda {
  days: number[];
  start: string;
  end: string;
  slotMinutes: number;
  minNoticeHours: number;
}

export interface GoogleConnection {
  email: string;
  calendarId: string;
  agenda: Agenda | null;
}

/** Credenciales de la aplicación, no del usuario: viven en el entorno, no en la base. */
export function appCredentials(): GoogleCredentials | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

// Guardar solo estas columnas: la fila de configuración tiene también el prompt y la API key.
const onlyRow = eq(chatbotConfig.id, true);

export async function saveConnection(input: { refreshToken: string; email: string; calendarId: string }): Promise<void> {
  await db
    .update(chatbotConfig)
    .set({
      googleRefreshTokenEncrypted: encryptApiKey(input.refreshToken, readEncryptionKey(process.env.ENCRYPTION_KEY)),
      googleEmail: input.email,
      googleCalendarId: input.calendarId,
      updatedAt: new Date(),
    })
    .where(onlyRow);
}

export async function disconnect(): Promise<void> {
  await db
    .update(chatbotConfig)
    .set({ googleRefreshTokenEncrypted: null, googleEmail: null, googleCalendarId: null, updatedAt: new Date() })
    .where(onlyRow);
}

export async function saveAgenda(agenda: Agenda): Promise<void> {
  await db
    .update(chatbotConfig)
    .set({
      agendaDays: agenda.days.join(","),
      agendaStart: agenda.start,
      agendaEnd: agenda.end,
      agendaSlotMinutes: agenda.slotMinutes,
      agendaMinNoticeHours: agenda.minNoticeHours,
      updatedAt: new Date(),
    })
    .where(onlyRow);
}

/** Lo que se puede mostrar: nunca incluye el permiso guardado. */
export async function getConnection(): Promise<GoogleConnection | null> {
  const [row] = await db.select().from(chatbotConfig);
  if (!row?.googleRefreshTokenEncrypted || !row.googleEmail || !row.googleCalendarId) return null;
  return { email: row.googleEmail, calendarId: row.googleCalendarId, agenda: agendaOf(row) };
}

/** El permiso descifrado, solo para llamar a Google desde el servidor. */
export async function getRefreshToken(): Promise<string | null> {
  const [row] = await db.select().from(chatbotConfig);
  if (!row?.googleRefreshTokenEncrypted) return null;
  return decryptApiKey(row.googleRefreshTokenEncrypted, readEncryptionKey(process.env.ENCRYPTION_KEY));
}

function agendaOf(row: typeof chatbotConfig.$inferSelect): Agenda | null {
  if (!row.agendaDays || !row.agendaStart || !row.agendaEnd || !row.agendaSlotMinutes || !row.agendaMinNoticeHours) {
    return null;
  }
  const days = row.agendaDays
    .split(",")
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  if (!days.length) return null;
  return {
    days,
    start: row.agendaStart,
    end: row.agendaEnd,
    slotMinutes: row.agendaSlotMinutes,
    minNoticeHours: row.agendaMinNoticeHours,
  };
}
