import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { canSeeFeed, listFeed } from "@/server/evidence";
import { getCurrentEvent } from "@/server/participants";

/** Feed de la edición vigente (spec §15). Sin datos del giver antes del reveal. */
export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  const db = getDb();
  const current = await getCurrentEvent(db);
  if (!current) return Response.json({ event: null, items: [] });
  if (!canSeeFeed(current.event, Boolean(user))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return Response.json({
    event: { id: current.event.id, name: current.event.name },
    items: await listFeed(db, current.event.id),
  });
}
