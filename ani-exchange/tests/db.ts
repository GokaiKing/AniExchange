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
    truncate table rate_limits, audit_log, notification_log, evidence_images, evidence, proposals, assignments,
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

/** Crea `n` usuarios inscritos (activos) en la edición. Devuelve los participant ids. */
export async function addParticipants(
  db: Database,
  eventId: string,
  n: number,
  status: "active" | "withdrawn" | "no_show" = "active",
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const u = await createUser(db, { role: "user", name: `P${i}` });
    const [row] = await db
      .insert(schema.participants)
      .values({
        eventId,
        userId: u.id,
        platform: "anilist",
        profileUrl: `https://anilist.co/user/p${i}/`,
        profileUsername: `p${i}`,
        maxEpisodes: 26,
        bannedTags: [],
        allowedTags: [],
        status,
      })
      .returning({ id: schema.participants.id });
    ids.push(row.id);
  }
  return ids;
}
