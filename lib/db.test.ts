// Integración: requiere la base local (docker compose up -d).
import { afterAll, expect, it } from "vitest";
import { sql } from "./db";

afterAll(() => sql.end());

it("se conecta a PostgreSQL 17", async () => {
  const [row] = await sql`select current_setting('server_version_num')::int as v`;
  expect(Math.floor(row.v / 10000)).toBe(17);
});
