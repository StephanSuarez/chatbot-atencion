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

## Scripts

- `npm test` — Vitest (unitarios e integración; requiere la base levantada)
- `npm run lint`, `npm run typecheck`, `npm run build`
- `npm run db:generate` — genera una migración a partir de `lib/schema.ts`
