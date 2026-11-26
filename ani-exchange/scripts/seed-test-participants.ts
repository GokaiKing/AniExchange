/**
 * SOLO DESARROLLO. Inscribe participantes de prueba en la edición vigente y,
 * con --draw, cierra la inscripción y ejecuta el sorteo.
 *   npm run db:seed:test            # solo inscribe
 *   npm run db:seed:test -- --draw  # inscribe y sortea
 *
 * Los usuarios de prueba tienen Discord IDs falsos: sus DMs fallan (sirve para
 * ver "Requieren atención" en el panel). Usan perfiles públicos reales de
 * AniList/MAL para que los links y la revisión de listas funcionen.
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const TEST_USERS = [
  {
    name: "Prueba Ana",
    platform: "anilist" as const,
    profileUrl: "https://anilist.co/user/Animeanimeanime/",
    profileUsername: "Animeanimeanime",
    maxEpisodes: 26,
    bannedTags: ["Horror", "Gore"],
    allowedTags: ["Romance", "Slice of Life"],
    allowPtw: true,
  },
  {
    name: "Prueba Beto",
    platform: "mal" as const,
    profileUrl: "https://myanimelist.net/profile/Xinil",
    profileUsername: "Xinil",
    maxEpisodes: 13,
    bannedTags: ["Mecha"],
    allowedTags: ["Action"],
    allowPtw: false,
  },
  {
    name: "Prueba Caro",
    platform: "anilist" as const,
    profileUrl: "https://anilist.co/user/Anime/",
    profileUsername: "Anime",
    maxEpisodes: null,
    bannedTags: [],
    allowedTags: ["Mystery", "Psychological", "Thriller"],
    allowPtw: true,
  },
  {
    name: "Prueba Dani",
    platform: "mal" as const,
    profileUrl: "https://myanimelist.net/profile/Xinil",
    profileUsername: "Xinil",
    maxEpisodes: 26,
    bannedTags: ["Sports", "Music", "Ecchi"],
    allowedTags: [],
    allowPtw: true,
  },
];

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error(`Por seguridad este script solo corre contra una base local (DATABASE_URL apunta a ${url.hostname})`);
  }

  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("@/db");
  const { participants, user } = await import("@/db/schema");
  const { getCurrentEvent } = await import("@/server/participants");
  const { closePhaseNow, runDueActions } = await import("@/server/tick");

  const db = getDb();
  await runDueActions(db); // por si la inscripción aún no está abierta
  const current = await getCurrentEvent(db);
  if (!current) throw new Error("No hay edición vigente: crea una en el panel o corre npm run db:seed");
  const { event } = current;

  for (const [i, t] of TEST_USERS.entries()) {
    const id = `test-user-${i + 1}`;
    const discordId = `10000000000000000${i + 1}`;
    await db
      .insert(user)
      .values({ id, name: t.name, email: `${discordId}@discord.invalid`, discordId, role: "user" })
      .onConflictDoNothing();
    await db
      .insert(participants)
      .values({ eventId: event.id, userId: id, ...t })
      .onConflictDoUpdate({
        target: [participants.eventId, participants.userId],
        set: { ...t, status: "active" },
      });
  }
  const all = await db.select().from(participants).where(eq(participants.eventId, event.id));
  console.log(`"${event.name}": ${all.filter((p) => p.status === "active").length} participantes activos.`);

  if (process.argv.includes("--draw")) {
    const [admin] = await db.select().from(user).where(eq(user.role, "superadmin")).limit(1);
    if (!admin) throw new Error("No hay superadmin para registrar la acción");
    const actions = await closePhaseNow(db, admin.id, event.id, "registration");
    console.log("Sorteo:", actions.map((a) => a.type).join(", "));
    console.log("Los DMs quedaron en cola: usa 'Enviar DMs pendientes ahora' en el panel.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
