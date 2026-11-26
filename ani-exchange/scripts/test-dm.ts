/**
 * Envía un DM de prueba (con el formato del DM de asignación y datos de
 * ejemplo) a los superadmins, para verificar que el bot está bien configurado.
 *   npm run dm:test
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("@/db");
  const { user } = await import("@/db/schema");
  const { dayEndUtc, addDays, todayAppDate } = await import("@/lib/dates");
  const { createDiscordSender } = await import("@/lib/discord");
  const { getEnv } = await import("@/lib/env");
  const { assignmentMessage } = await import("@/server/messages");

  const env = getEnv();
  if (!env.DISCORD_BOT_TOKEN) throw new Error("Falta DISCORD_BOT_TOKEN en .env.local");

  const admins = await getDb().select().from(user).where(eq(user.role, "superadmin"));
  if (admins.length === 0) throw new Error("No hay superadmins: inicia sesión primero");

  const content =
    "🧪 **Prueba del bot de AniExchange**: esto es un ejemplo, no una asignación real.\n\n" +
    assignmentMessage({
      eventName: "Intercambio (prueba)",
      receiverName: "Usuario_de_ejemplo",
      allowedTags: ["Action", "Isekai"],
      bannedTags: ["Horror"],
      maxEpisodes: 24,
      allowPtw: true,
      deadline: dayEndUtc(addDays(todayAppDate(), 7)),
      link: `${env.APP_BASE_URL}/assignment`,
      redraw: false,
    });

  const send = createDiscordSender({ botToken: env.DISCORD_BOT_TOKEN, appBaseUrl: env.APP_BASE_URL });
  for (const admin of admins) {
    const result = await send(admin.discordId, content);
    console.log(`${admin.name}: ${result.ok ? "enviado ✓" : `${result.kind} — ${result.error}`}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
