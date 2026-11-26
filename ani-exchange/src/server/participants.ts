import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { RegistrationInput } from "@/lib/registration";
import type { Database, Transaction } from "@/db";
import { eventPhases, events, participants } from "@/db/schema";
import { parseProfileInput, type ProfileRef, type VerifyResult } from "@/lib/profiles";
import type { EventRow, PhaseRow } from "./events";
import { isPhaseActive } from "./phases";

export type ParticipantRow = typeof participants.$inferSelect;

export {
  MAX_ALLOWED_TAGS,
  MAX_BANNED_TAGS,
  type RegistrationInput,
  registrationSchema,
} from "@/lib/registration";

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export type EventWithPhases = { event: EventRow; phases: PhaseRow[] };

/** La edición vigente: la más reciente que no esté archivada. */
export async function getCurrentEvent(db: Database): Promise<EventWithPhases | null> {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.archived, false))
    .orderBy(desc(events.year), desc(events.createdAt))
    .limit(1);
  if (!event) return null;
  const phases = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, event.id))
    .orderBy(asc(eventPhases.position));
  return { event, phases };
}

export function registrationPhaseOf(phases: PhaseRow[]): PhaseRow {
  const phase = phases.find((p) => p.key === "registration");
  if (!phase) throw new Error("La edición no tiene fase de inscripción");
  return phase;
}

export async function getRegistration(
  db: Database,
  eventId: string,
  userId: string,
): Promise<ParticipantRow | null> {
  const [row] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.userId, userId)));
  return row ?? null;
}

export async function countActiveParticipants(db: Database, eventId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.status, "active")));
  return row.count;
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export type RegistrationResult =
  | { ok: true; participant: ParticipantRow }
  | { ok: false; error: string; field?: keyof RegistrationInput };

const CLOSED: RegistrationResult = {
  ok: false,
  error: "La inscripción no está abierta para esta edición",
};

/**
 * Bloquea la fase de inscripción (FOR SHARE) y confirma que sigue abierta.
 * El sorteo toma FOR UPDATE sobre la misma fila, así que no puede correr a la
 * mitad de una inscripción.
 */
async function lockOpenRegistration(
  tx: Transaction,
  eventId: string,
  now: Date,
): Promise<boolean> {
  const [row] = await tx
    .select({ phase: eventPhases, event: events })
    .from(eventPhases)
    .innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, "registration")))
    .for("share");
  return Boolean(row) && isPhaseActive(row.phase, row.event, now);
}

export async function saveRegistration(
  db: Database,
  params: {
    userId: string;
    eventId: string;
    input: RegistrationInput;
    now: Date;
    /** Nombres válidos de géneros/tags (catálogo de AniList). */
    validTags: ReadonlySet<string>;
    verify: (ref: ProfileRef) => Promise<VerifyResult>;
  },
): Promise<RegistrationResult> {
  const { userId, eventId, input, now } = params;

  // Chequeo rápido antes de llamar a servicios externos.
  const current = await db
    .select({ phase: eventPhases, event: events })
    .from(eventPhases)
    .innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, "registration")));
  if (!current[0] || !isPhaseActive(current[0].phase, current[0].event, now)) return CLOSED;

  const unknownTag = [...input.bannedTags, ...input.allowedTags].find(
    (tag) => !params.validTags.has(tag),
  );
  if (unknownTag) {
    return { ok: false, error: `"${unknownTag}" no es un género o tag de AniList`, field: "bannedTags" };
  }

  const parsed = parseProfileInput(input.platform, input.profile);
  if (!parsed.ok) return { ok: false, error: parsed.message, field: "profile" };

  const verified = await params.verify(parsed.ref);
  if (!verified.ok) return { ok: false, error: verified.message, field: "profile" };

  return db.transaction(async (tx) => {
    if (!(await lockOpenRegistration(tx, eventId, now))) return CLOSED;

    const values = {
      platform: input.platform,
      profileUrl: verified.profileUrl,
      profileUsername: verified.username,
      maxEpisodes: input.maxEpisodes,
      bannedTags: input.bannedTags,
      allowedTags: input.allowedTags,
      allowPtw: input.allowPtw,
      status: "active" as const,
    };
    const [participant] = await tx
      .insert(participants)
      .values({ eventId, userId, ...values })
      .onConflictDoUpdate({
        target: [participants.eventId, participants.userId],
        set: { ...values, updatedAt: now },
      })
      .returning();
    return { ok: true as const, participant };
  });
}

export async function withdrawRegistration(
  db: Database,
  params: { userId: string; eventId: string; now: Date },
): Promise<{ ok: true } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    if (!(await lockOpenRegistration(tx, params.eventId, params.now))) {
      return { ok: false as const, error: "Ya no puedes retirarte: la inscripción cerró" };
    }
    const updated = await tx
      .update(participants)
      .set({ status: "withdrawn", updatedAt: params.now })
      .where(and(eq(participants.eventId, params.eventId), eq(participants.userId, params.userId)))
      .returning({ id: participants.id });
    return updated.length > 0
      ? { ok: true as const }
      : { ok: false as const, error: "No estás inscrito en esta edición" };
  });
}
