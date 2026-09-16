import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ponytail: un solo cliente por proceso. En Vercel se usa el pooler de Supabase en modo transacción,
// que no admite sentencias preparadas (documentación de Supabase).
export const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle(sql, { schema });
