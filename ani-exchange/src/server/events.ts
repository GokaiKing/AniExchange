import { asc, desc, eq } from "drizzle-orm";
import type { Database } from "@/db";
import { eventPhases, events } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { addYears, dayEndUtc, dayStartUtc, type IsoDate, toAppDate } from "@/lib/dates";
import {
  defaultPhasePlan,
  PHASE_ORDER,
  type PhasePlanItem,
  samePlan,
  type ValidationResult,
  validatePhasePlan,
} from "./phases";

export type EventRow = typeof events.$inferSelect;
export type PhaseRow = typeof eventPhases.$inferSelect;

export async function listEvents(db: Database): Promise<EventRow[]> {
  return db.select().from(events).orderBy(desc(events.year), desc(events.createdAt));
}

export async function getEventWithPhases(
  db: Database,
  eventId: string,
): Promise<{ event: EventRow; phases: PhaseRow[] } | null> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event) return null;
  const phases = await db
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId))
    .orderBy(asc(eventPhases.position));
  return { event, phases };
}

function toPlanItem(phase: PhaseRow): PhasePlanItem {
  return {
    key: phase.key,
    enabled: phase.enabled,
    startsAt: phase.startsAt,
    endsAt: phase.endsAt,
    autoAdvance: phase.autoAdvance,
    onMiss: phase.onMiss,
    reminderDays: phase.reminderDays,
  };
}

/** Desplaza un plan N años manteniendo días de calendario en Hermosillo. */
function shiftPlan(plan: PhasePlanItem[], years: number): PhasePlanItem[] {
  if (years === 0) return plan;
  return plan.map((item) => ({
    ...item,
    startsAt: dayStartUtc(addYears(toAppDate(item.startsAt), years)),
    endsAt: dayEndUtc(addYears(toAppDate(item.endsAt), years)),
  }));
}

export type CreateEventInput = {
  name: string;
  year: number;
  /** Copia reglas y fechas (desplazadas por la diferencia de años) de otra edición. */
  cloneFromEventId?: string | null;
  /** Primer día de inscripción si no se clona. */
  startDate?: IsoDate | null;
};

export class EventInputError extends Error {}

export async function createEvent(
  db: Database,
  actorId: string | null,
  input: CreateEventInput,
): Promise<EventRow> {
  let plan: PhasePlanItem[];
  let feedPublic = false;

  if (input.cloneFromEventId) {
    const source = await getEventWithPhases(db, input.cloneFromEventId);
    if (!source) throw new EventInputError("La edición a clonar no existe");
    plan = shiftPlan(source.phases.map(toPlanItem), input.year - source.event.year);
    feedPublic = source.event.feedPublic;
  } else if (input.startDate) {
    plan = defaultPhasePlan(input.startDate);
  } else {
    throw new EventInputError("Indica la fecha de inicio o una edición a clonar");
  }

  const validation = validatePhasePlan(plan);
  if (!validation.ok) {
    throw new EventInputError(validation.errors.map((error) => error.message).join("; "));
  }

  return db.transaction(async (tx) => {
    const [event] = await tx
      .insert(events)
      .values({ name: input.name, year: input.year, feedPublic })
      .returning();

    const phases = await tx
      .insert(eventPhases)
      .values(
        plan.map((item, position) => ({
          eventId: event.id,
          key: item.key,
          position,
          enabled: item.enabled,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          autoAdvance: item.autoAdvance,
          onMiss: item.onMiss,
          reminderDays: item.reminderDays,
        })),
      )
      .returning();

    await writeAudit(tx, {
      actorId,
      action: input.cloneFromEventId ? "event.clone" : "event.create",
      entity: "event",
      entityId: event.id,
      after: { event, phases, clonedFrom: input.cloneFromEventId ?? null },
    });

    return event;
  });
}

/**
 * Guarda el plan completo de fases de una edición. Bloquea las filas de fases
 * mientras valida y escribe, y deja before/after en audit_log.
 */
export async function updatePhases(
  db: Database,
  actorId: string | null,
  eventId: string,
  plan: PhasePlanItem[],
  options: { confirmClosedEdit?: boolean } = {},
): Promise<ValidationResult> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(eventPhases)
      .where(eq(eventPhases.eventId, eventId))
      .orderBy(asc(eventPhases.position))
      .for("update");

    if (current.length !== PHASE_ORDER.length) {
      return {
        ok: false,
        needsClosedConfirmation: false,
        errors: [{ message: "La edición no existe o le faltan fases" }],
      };
    }

    const validation = validatePhasePlan(plan, {
      current: current.map((row) => ({ ...toPlanItem(row), status: row.status })),
      confirmClosedEdit: options.confirmClosedEdit,
    });
    if (!validation.ok) return validation;

    const before: PhaseRow[] = [];
    const after: PhaseRow[] = [];
    for (const item of plan) {
      const row = current.find((phase) => phase.key === item.key)!;
      if (samePlan(toPlanItem(row), item)) continue;
      const [updated] = await tx
        .update(eventPhases)
        .set({
          enabled: item.enabled,
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          autoAdvance: item.autoAdvance,
          onMiss: item.onMiss,
          reminderDays: item.reminderDays,
        })
        .where(eq(eventPhases.id, row.id))
        .returning();
      before.push(row);
      after.push(updated);
    }

    if (after.length > 0) {
      await writeAudit(tx, {
        actorId,
        action: "event.phases.update",
        entity: "event",
        entityId: eventId,
        before,
        after,
      });
    }

    return { ok: true };
  });
}

export type EventFlags = { paused?: boolean; archived?: boolean; feedPublic?: boolean };

export async function setEventFlags(
  db: Database,
  actorId: string | null,
  eventId: string,
  flags: EventFlags,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
    if (!before) throw new EventInputError("La edición no existe");
    const [after] = await tx.update(events).set(flags).where(eq(events.id, eventId)).returning();
    await writeAudit(tx, {
      actorId,
      action: "event.flags.update",
      entity: "event",
      entityId: eventId,
      before: { paused: before.paused, archived: before.archived, feedPublic: before.feedPublic },
      after: { paused: after.paused, archived: after.archived, feedPublic: after.feedPublic },
    });
  });
}
