/**
 * Reveal (spec §13). Todo lo que expone al giver vive aquí y exige que la
 * fase `reveal` ya haya abierto. Antes de eso, ninguna consulta de este
 * archivo debe usarse para responder a usuarios.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db";
import { assignments, eventPhases, events, evidence, participants, proposals, user } from "@/db/schema";
import { writeAudit } from "@/lib/audit";

type PhaseLike = Pick<typeof eventPhases.$inferSelect, "key" | "enabled" | "status">;

/** El reveal ocurrió si la fase está habilitada y ya abrió (o cerró). */
export function isRevealed(phases: PhaseLike[]): boolean {
  const reveal = phases.find((p) => p.key === "reveal");
  return Boolean(reveal && reveal.enabled && reveal.status !== "pending");
}

export async function eventIsRevealed(db: Database, eventId: string): Promise<boolean> {
  const phases = await db
    .select({ key: eventPhases.key, enabled: eventPhases.enabled, status: eventPhases.status })
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId));
  return isRevealed(phases);
}

export type Person = { name: string; image: string | null };

/** Giver de cada asignación vigente. Solo para usar tras el reveal. */
export async function giversByAssignment(
  db: Database,
  assignmentIds: string[],
): Promise<Map<string, Person>> {
  const result = new Map<string, Person>();
  if (assignmentIds.length === 0) return result;
  const rows = await db
    .select({ assignmentId: assignments.id, name: user.name, image: user.image })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.giverId))
    .innerJoin(user, eq(user.id, participants.userId))
    .where(inArray(assignments.id, assignmentIds));
  for (const r of rows) result.set(r.assignmentId, { name: r.name, image: r.image });
  return result;
}

export type RevealPair = {
  assignmentId: string;
  giver: Person;
  receiver: Person;
  anime: { title: string; sourceUrl: string; coverUrl: string | null } | null;
  rating: number | null;
  hasReview: boolean;
};

/**
 * Todos los pares de la edición, en el orden del ciclo (A → B → C → …).
 * Lanza si la edición todavía no hizo el reveal.
 */
export async function revealSummary(db: Database, eventId: string): Promise<RevealPair[]> {
  if (!(await eventIsRevealed(db, eventId))) throw new Error("El reveal todavía no ocurre");
  return buildPairs(db, eventId);
}

export class PairingsHiddenError extends Error {}

/**
 * Emparejamientos para el superadmin ANTES del reveal (spec §7.1): solo si la
 * edición tiene `admin_can_see_pairings` y cada consulta queda en audit_log.
 */
export async function pairingsForSuperadmin(db: Database, actorId: string, eventId: string): Promise<RevealPair[]> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event?.adminCanSeePairings) {
    throw new PairingsHiddenError("Los emparejamientos están ocultos para esta edición");
  }
  await writeAudit(db, { actorId, action: "pairings.view", entity: "event", entityId: eventId });
  return buildPairs(db, eventId);
}

async function buildPairs(db: Database, eventId: string): Promise<RevealPair[]> {
  const giverP = alias(participants, "giver_p");
  const giverU = alias(user, "giver_u");
  const receiverP = alias(participants, "receiver_p");
  const receiverU = alias(user, "receiver_u");

  const rows = await db
    .select({
      assignmentId: assignments.id,
      giverId: assignments.giverId,
      receiverId: assignments.receiverId,
      giverName: giverU.name,
      giverImage: giverU.image,
      receiverName: receiverU.name,
      receiverImage: receiverU.image,
    })
    .from(assignments)
    .innerJoin(giverP, eq(giverP.id, assignments.giverId))
    .innerJoin(giverU, eq(giverU.id, giverP.userId))
    .innerJoin(receiverP, eq(receiverP.id, assignments.receiverId))
    .innerJoin(receiverU, eq(receiverU.id, receiverP.userId))
    .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.assignmentId);
  const chosen = await db
    .select({ assignmentId: proposals.assignmentId, title: proposals.title, sourceUrl: proposals.sourceUrl, coverUrl: proposals.coverUrl })
    .from(proposals)
    .where(and(inArray(proposals.assignmentId, ids), eq(proposals.chosen, true)));
  const reviews = await db
    .select({ assignmentId: evidence.assignmentId, rating: evidence.rating })
    .from(evidence)
    .where(inArray(evidence.assignmentId, ids));

  const byGiver = new Map(rows.map((r) => [r.giverId, r]));
  const toPair = (r: (typeof rows)[number]): RevealPair => {
    const anime = chosen.find((c) => c.assignmentId === r.assignmentId);
    const review = reviews.find((v) => v.assignmentId === r.assignmentId);
    return {
      assignmentId: r.assignmentId,
      giver: { name: r.giverName, image: r.giverImage },
      receiver: { name: r.receiverName, image: r.receiverImage },
      anime: anime ? { title: anime.title, sourceUrl: anime.sourceUrl, coverUrl: anime.coverUrl } : null,
      rating: review?.rating === null || review?.rating === undefined ? null : Number(review.rating),
      hasReview: Boolean(review),
    };
  };

  // Recorre el ciclo desde el primero; agrega al final lo que no esté en él.
  const ordered: RevealPair[] = [];
  const seen = new Set<string>();
  let current: (typeof rows)[number] | undefined = rows[0];
  while (current && !seen.has(current.assignmentId)) {
    seen.add(current.assignmentId);
    ordered.push(toPair(current));
    current = byGiver.get(current.receiverId);
  }
  for (const r of rows) if (!seen.has(r.assignmentId)) ordered.push(toPair(r));
  return ordered;
}
