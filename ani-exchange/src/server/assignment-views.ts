/**
 * Vistas de "Mi asignación" (spec §7.1, §9).
 *
 * ANONIMATO: la vista del receptor se construye con una consulta que NO
 * selecciona giver_id ni nada que lo identifique. No agregar columnas del giver
 * aquí antes del reveal (hito 8).
 */
import { and, count, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { assignments, eventPhases, participants, proposals, user } from "@/db/schema";
import type { Platform } from "@/lib/profiles";
import { getCurrentEvent } from "./participants";

export type GiverView = {
  assignmentId: string;
  receiver: {
    name: string;
    image: string | null;
    platform: Platform;
    profileUrl: string;
    profileUsername: string;
    maxEpisodes: number;
    bannedTags: string[];
    allowedTags: string[];
    allowPtw: boolean;
  };
  proposalsDeadline: Date | null;
};

export type ReceiverView = {
  assignmentId: string;
  proposalCount: number;
  selectionDeadline: Date | null;
};

export type MyAssignmentView =
  | { state: "no_event" }
  | { state: "not_registered"; event: { id: string; name: string } }
  | { state: "not_drawn"; event: { id: string; name: string } }
  | {
      state: "drawn";
      event: { id: string; name: string };
      asGiver: GiverView | null;
      asReceiver: ReceiverView | null;
    };

async function phaseEnd(db: Database, eventId: string, key: "proposals" | "selection") {
  const [row] = await db
    .select({ endsAt: eventPhases.endsAt, enabled: eventPhases.enabled })
    .from(eventPhases)
    .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, key)));
  return row?.enabled ? row.endsAt : null;
}

/** Lo que ve el giver: datos públicos del receptor. */
export async function getGiverView(
  db: Database,
  eventId: string,
  participantId: string,
): Promise<GiverView | null> {
  const [row] = await db
    .select({
      assignmentId: assignments.id,
      name: user.name,
      image: user.image,
      platform: participants.platform,
      profileUrl: participants.profileUrl,
      profileUsername: participants.profileUsername,
      maxEpisodes: participants.maxEpisodes,
      bannedTags: participants.bannedTags,
      allowedTags: participants.allowedTags,
      allowPtw: participants.allowPtw,
    })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.receiverId))
    .innerJoin(user, eq(user.id, participants.userId))
    .where(
      and(
        eq(assignments.eventId, eventId),
        eq(assignments.giverId, participantId),
        isNull(assignments.supersededBy),
      ),
    );
  if (!row) return null;
  const { assignmentId, ...receiver } = row;
  return { assignmentId, receiver, proposalsDeadline: await phaseEnd(db, eventId, "proposals") };
}

/** Lo que ve el receptor: SIN datos del giver. */
export async function getReceiverView(
  db: Database,
  eventId: string,
  participantId: string,
): Promise<ReceiverView | null> {
  const [row] = await db
    .select({ assignmentId: assignments.id }) // ← nunca giver_id
    .from(assignments)
    .where(
      and(
        eq(assignments.eventId, eventId),
        eq(assignments.receiverId, participantId),
        isNull(assignments.supersededBy),
      ),
    );
  if (!row) return null;
  const [{ total }] = await db
    .select({ total: count() })
    .from(proposals)
    .where(eq(proposals.assignmentId, row.assignmentId));
  return {
    assignmentId: row.assignmentId,
    proposalCount: total,
    selectionDeadline: await phaseEnd(db, eventId, "selection"),
  };
}

export async function getMyAssignmentView(db: Database, userId: string): Promise<MyAssignmentView> {
  const current = await getCurrentEvent(db);
  if (!current) return { state: "no_event" };
  const event = { id: current.event.id, name: current.event.name };

  const [participant] = await db
    .select({ id: participants.id, status: participants.status })
    .from(participants)
    .where(and(eq(participants.eventId, event.id), eq(participants.userId, userId)));
  if (!participant || participant.status === "withdrawn") return { state: "not_registered", event };
  if (!current.event.drawExecutedAt) return { state: "not_drawn", event };

  const [asGiver, asReceiver] = await Promise.all([
    getGiverView(db, event.id, participant.id),
    getReceiverView(db, event.id, participant.id),
  ]);
  return { state: "drawn", event, asGiver, asReceiver };
}
