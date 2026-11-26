/**
 * Crea una edición de ejemplo para desarrollo si no existe ninguna del año.
 *   npm run db:seed
 */
import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  // Imports dinámicos: deben evaluarse después de cargar el .env.
  const { eq } = await import("drizzle-orm");
  const { getDb } = await import("@/db");
  const { events } = await import("@/db/schema");
  const { todayAppDate } = await import("@/lib/dates");
  const { createEvent } = await import("@/server/events");

  const db = getDb();
  const today = todayAppDate();
  const year = Number(today.slice(0, 4));

  const existing = await db.select().from(events).where(eq(events.year, year));
  if (existing.length > 0) {
    console.log(`Ya existe una edición ${year} (${existing[0].name}); no se crea otra.`);
    return;
  }

  const event = await createEvent(db, null, {
    name: `Intercambio ${year}`,
    year,
    startDate: today,
  });
  console.log(`Creada "${event.name}" (${event.id}) con inscripción desde ${today}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
