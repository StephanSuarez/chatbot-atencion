# Chatbot

Plataforma con un único chatbot configurable. Contexto: `constitution.md`, `roadmap.md`, `specs/`.

## Desarrollo local

```bash
npm install
docker compose up -d                 # PostgreSQL 17 en localhost:5432
cp .env.example .env.local           # y completar ENCRYPTION_KEY con: openssl rand -base64 32
npm run db:migrate                   # aplica las migraciones de ./drizzle
npm run dev
```

La app no arranca si falta `DATABASE_URL` o si `ENCRYPTION_KEY` no es de 32 bytes en base64.

### Agendamiento con Google (opcional, feature 006)

Sin estas variables todo funciona, pero el chatbot dice que no puede agendar citas. Para habilitarlo:

1. En [Google Cloud](https://console.cloud.google.com/), crea un proyecto y habilita la **API de Google Calendar**.
2. Configura la **pantalla de consentimiento** (en modo prueba basta, agregando la cuenta del negocio como usuario de prueba).
3. Crea credenciales de tipo **ID de cliente de OAuth → Aplicación web**, con este URI de redirección autorizado:
   `http://localhost:3000/api/google/callback`
4. Copia el id y el secreto en `.env.local` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`).

Después, en «Tu chatbot» → «Agendamiento de citas», conecta la cuenta y define el horario de atención.
Los permisos que se piden son los mínimos: crear eventos (`calendar.events`) y consultar disponibilidad
(`calendar.freebusy`). El permiso se guarda cifrado, igual que la API key.

## Scripts

- `npm test` — Vitest (unitarios e integración; requiere la base levantada)
- `npm run lint`, `npm run typecheck`, `npm run build`
- `npm run db:generate` — genera una migración a partir de `lib/schema.ts`
