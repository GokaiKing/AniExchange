import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { getMyAssignmentView } from "@/server/assignment-views";

/** Asignación del usuario (spec §15). Nunca incluye datos del giver. */
export async function GET(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(await getMyAssignmentView(getDb(), user.id));
}
