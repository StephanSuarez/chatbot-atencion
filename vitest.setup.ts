import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL!);
  const name = url.pathname.slice(1);

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = postgres(adminUrl.href);
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database "${name}"`);
  await admin.end();

  const client = postgres(url.href, { onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
}
