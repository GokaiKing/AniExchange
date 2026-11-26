/**
 * Gestión de participantes desde el panel (spec §14.3, §14.5).
 *
 * Nada aquí expone emparejamientos: las listas muestran a cada participante
 * con su propio estado, nunca a quién le da.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { assignments, events, evidence, notificationLog, participants, proposals, user } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { enqueueAssignmentDms, skipAssignmentDms } from "./notifications";

export class ParticipantActionError extends Error {}

export type ParticipantListItem = {
  id: string;
  name: string;
  image: string | null;
  platform: "mal" | "anilist";
  profileUrl: string;
  profileUsername: string;
  maxEpisodes: number | null;
  status: "active" | "withdrawn" | "no_show";
  /**
   * ¿Terminó el anime que le tocó ver? (subió review). null si no tenía anime
   * elegido. Para la dinámica de ban del server.
   */
  finished: boolean | null;
  /** DM de asignación de esta persona como giver (no revela a quién le da). */
  assignmentDm: { notificationId: string; status: string; attempts: number; lastError: string | null } | null;
};

export async function listParticipants(db: Database, eventId: string): Promise<ParticipantListItem[]> {
  const rows = await db
    .select({
      id: participants.id,
      userId: participants.userId,
      name: user.name,
      image: user.image,
      platform: participants.platform,
      profileUrl: participants.profileUrl,
      profileUsername: participants.profileUsername,
      maxEpisodes: participants.maxEpisodes,
      status: participants.status,
    })
    .from(participants)
    .innerJoin(user, eq(user.id, participants.userId))
    .where(eq(participants.eventId, eventId))
    .orderBy(asc(user.name));

  const dms = await db
    .select()
    .from(notificationLog)
    .where(and(eq(notificationLog.eventId, eventId), eq(notificationLog.kind, "assignment")))
    .orderBy(asc(notificationLog.createdAt));
  // El más reciente por usuario (tras repetir sorteo hay varios).
  const latestDm = new Map(dms.map((n) => [n.userId, n]));

  // Como receptor: ¿tenía anime elegido y subió review?
  const received = await db
    .select({ receiverId: assignments.receiverId, chosen: proposals.id, review: evidence.id })
    .from(assignments)
    .leftJoin(proposals, and(eq(proposals.assignmentId, assignments.id), eq(proposals.chosen, true)))
    .leftJoin(evidence, eq(evidence.assignmentId, assignments.id))
    .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));
  const finishedBy = new Map(received.map((r) => [r.receiverId, r.chosen ? Boolean(r.review) : null]));

  return rows.map(({ userId, ...r }) => {
    const dm = latestDm.get(userId);
    return {
      ...r,
      finished: finishedBy.get(r.id) ?? null,
      assignmentDm: dm ? { notificationId: dm.id, status: dm.status, attempts: dm.attempts, lastError: dm.lastError } : null,
    };
  });
}

/** Cambia el estado de un participante. "withdrawn" solo antes del sorteo. */
export async function setParticipantStatus(
  db: Database,
  actorId: string,
  participantId: string,
  status: "active" | "no_show" | "withdrawn",
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ participant: participants, drawn: events.drawExecutedAt })
      .from(participants)
      .innerJoin(events, eq(events.id, participants.eventId))
      .where(eq(participants.id, participantId))
      .for("update", { of: participants });
    if (!row) throw new ParticipantActionError("El participante no existe");
    if (status === "withdrawn" && row.drawn) {
      throw new ParticipantActionError("Después del sorteo usa \"sacar del ciclo\" en vez de quitar");
    }
    if (row.participant.status === status) return;
    await tx.update(participants).set({ status }).where(eq(participants.id, participantId));
    await writeAudit(tx, {
      actorId,
      action: "participant.status",
      entity: "participant",
      entityId: participantId,
      before: { status: row.participant.status },
      after: { status },
    });
  });
}

/**
 * Saca a X del ciclo: W → X → R pasa a W → R. X queda como no participó,
 * las dos asignaciones viejas quedan reemplazadas por la nueva y W recibe un
 * DM con su nuevo receptor. Nadie da ni recibe más de una vez.
 */
export async function removeFromCycle(
  db: Database,
  actorId: string,
  participantId: string,
): Promise<{ newAssignmentId: string }> {
  return db.transaction(async (tx) => {
    const [x] = await tx.select().from(participants).where(eq(participants.id, participantId));
    if (!x) throw new ParticipantActionError("El participante no existe");
    const [event] = await tx.select().from(events).where(eq(events.id, x.eventId)).for("update");
    if (!event.drawExecutedAt) throw new ParticipantActionError("Todavía no hay sorteo");

    const active = and(eq(assignments.eventId, event.id), isNull(assignments.supersededBy));
    const [inbound] = await tx.select().from(assignments).where(and(active, eq(assignments.receiverId, x.id))).for("update");
    const [outbound] = await tx.select().from(assignments).where(and(active, eq(assignments.giverId, x.id))).for("update");
    if (!inbound || !outbound) throw new ParticipantActionError("Esa persona ya no está en el ciclo");
    if (inbound.giverId === outbound.receiverId) {
      throw new ParticipantActionError("Quedarían menos de 2 personas en el ciclo");
    }

    const newId = crypto.randomUUID();
    // Reemplazar primero (la FK superseded_by se verifica al commit) y luego insertar.
    for (const old of [inbound, outbound]) {
      await tx.update(assignments).set({ supersededBy: newId }).where(eq(assignments.id, old.id));
    }
    await tx.insert(assignments).values({
      id: newId,
      eventId: event.id,
      giverId: inbound.giverId,
      receiverId: outbound.receiverId,
    });
    await tx.update(participants).set({ status: "no_show" }).where(eq(participants.id, x.id));

    await skipAssignmentDms(tx, [inbound.id, outbound.id]);
    await enqueueAssignmentDms(tx, event.id, [newId], { reassigned: true });

    await writeAudit(tx, {
      actorId,
      action: "participant.remove_from_cycle",
      entity: "participant",
      entityId: x.id,
      before: { status: x.status, assignments: [inbound.id, outbound.id] },
      after: { status: "no_show", assignment: newId },
    });
    return { newAssignmentId: newId };
  });
}
