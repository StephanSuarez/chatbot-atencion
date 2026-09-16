// Aplica las migraciones con el migrador de drizzle-orm, como vitest.setup.ts. No se usa `drizzle-kit migrate`
// porque, si falla, sale con código 1 sin mostrar el error, y en el build de Vercel no se sabría por qué.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
await client.end();
console.log("Migraciones aplicadas.");
