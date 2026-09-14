// Prepara la base de tests: la crea si no existe y le aplica las migraciones.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);

  const admin = postgres({ ...parse(url), database: "postgres" });
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const client = postgres(url.href, { onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
}

function parse(url: URL) {
  return { host: url.hostname, port: Number(url.port), username: url.username, password: url.password };
}
