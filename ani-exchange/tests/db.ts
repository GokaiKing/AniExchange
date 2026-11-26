import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database } from "@/db";
import * as schema from "@/db/schema";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Las pruebas de integración se saltan si no hay TEST_DATABASE_URL. */
export const hasTestDb = Boolean(TEST_DATABASE_URL);

export function createTestDb() {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL no está definida");
  if (!/_test\b/.test(new URL(TEST_DATABASE_URL).pathname)) {
    // Protección: nunca truncar una base que no sea de pruebas.
    throw new Error("TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en _test");
  }
  const client = postgres(TEST_DATABASE_URL, { max: 5, onnotice: () => {} });
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, close: () => client.end() };
}

export async function resetDb(db: Database) {
  await db.execute(sql`
    truncate table audit_log, notification_log, evidence, proposals, assignments,
      participants, event_phases, events, verification, account, session, "user"
    restart identity cascade
  `);
}

export async function createUser(db: Database, overrides: Partial<typeof schema.user.$inferInsert> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  const discordId = overrides.discordId ?? `1${String(Math.floor(Math.random() * 1e17)).padStart(17, "0")}`;
  const [row] = await db
    .insert(schema.user)
    .values({
      id,
      name: "Tester",
      email: `${discordId}@discord.invalid`,
      discordId,
      role: "superadmin",
      ...overrides,
    })
    .returning();
  return row;
}
