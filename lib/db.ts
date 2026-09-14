import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// ponytail: un solo cliente por proceso; en Vercel se revisa el pooler de Supabase al desplegar (plan §6).
export const sql = postgres(process.env.DATABASE_URL!);
export const db = drizzle(sql, { schema });
