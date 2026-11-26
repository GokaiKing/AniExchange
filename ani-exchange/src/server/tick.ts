/**
 * Ejecución programada (spec §15). `runDueActions()` revisa la base y aplica lo
 * que toque: abrir fases cuyo inicio ya pasó, cerrar las vencidas ejecutando
 * su acción de cierre (el sorteo, al cerrar la inscripción) y abrir la
 * siguiente. Es idempotente: cada edición se procesa dentro de una transacción
 * con la fila del evento y sus fases bloqueadas (FOR UPDATE), y una fase
 * cerrada nunca se vuelve a ejecutar.
 */
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import {
  assignments,
  eventPhases,
  events,
  notificationLog,
  participants,
  proposals,
  type PhaseKey,
  user,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { toAppDate } from "@/lib/dates";
import { drawPairs, MIN_PARTICIPANTS, newSeed } from "./draw";
import type { EventRow, PhaseRow } from "./events";
import { PHASE_LABEL } from "./phases";

export type TickAction =
  | { type: "phase.open"; eventId: string; phase: PhaseKey }
  | { type: "phase.close"; eventId: string; phase: PhaseKey }
  | { type: "phase.waiting_manual"; eventId: string; phase: PhaseKey }
  | { type: "draw.execute"; eventId: string; participants: number }
  | { type: "draw.insufficient"; eventId: string; participants: number };

export class FlowError extends Error {}

// ---------------------------------------------------------------------------
// Sorteo
// ---------------------------------------------------------------------------

async function activeParticipantIds(tx: Transaction, eventId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.status, "active")));
  return rows.map((row) => row.id);
}

/** Avisa a los superadmins (el envío del DM llega en el hito 5). */
async function alertSuperadmins(tx: Transaction, eventId: string, kind: string, dedupeKey: string) {
  const admins = await tx.select({ id: user.id }).from(user).where(eq(user.role, "superadmin"));
  if (admins.length === 0) return;
  await tx
    .insert(notificationLog)
    .values(
      admins.map((admin) => ({
        eventId,
        userId: admin.id,
        kind,
        dedupeKey: `${dedupeKey}:${admin.id}`,
      })),
    )
    .onConflictDoNothing({ target: notificationLog.dedupeKey });
}

/**
 * Ejecuta el sorteo de la edición. Devuelve false (y pausa la edición) si hay
 * menos participantes activos que el mínimo.
 */
async function executeDraw(
  tx: Transaction,
  event: EventRow,
  actorId: string | null,
  now: Date,
  actions: TickAction[],
): Promise<boolean> {
  if (event.drawExecutedAt) return true; // ya se sorteó (defensa extra)

  const ids = await activeParticipantIds(tx, event.id);
  if (ids.length < MIN_PARTICIPANTS) {
    await tx.update(events).set({ paused: true }).where(eq(events.id, event.id));
    event.paused = true;
    await alertSuperadmins(
      tx,
      event.id,
      "admin_alert",
      `${event.id}:draw_insufficient:${toAppDate(now)}`,
    );
    await writeAudit(tx, {
      actorId,
      action: "draw.insufficient",
      entity: "event",
      entityId: event.id,
      after: { participants: ids.length, minimum: MIN_PARTICIPANTS, paused: true },
    });
    actions.push({ type: "draw.insufficient", eventId: event.id, participants: ids.length });
    return false;
  }

  const seed = newSeed();
  const pairs = drawPairs(ids, seed);
  await tx.insert(assignments).values(pairs.map((pair) => ({ eventId: event.id, ...pair })));
  await tx
    .update(events)
    .set({ drawSeed: seed, drawExecutedAt: now })
    .where(eq(events.id, event.id));
  event.drawSeed = seed;
  event.drawExecutedAt = now;

  // Anonimato: la auditoría guarda la semilla y el conteo, no los pares.
  await writeAudit(tx, {
    actorId,
    action: "draw.execute",
    entity: "event",
    entityId: event.id,
    after: { seed, participants: ids.length },
  });
  actions.push({ type: "draw.execute", eventId: event.id, participants: ids.length });
  return true;
}

// ---------------------------------------------------------------------------
// Avance de fases
// ---------------------------------------------------------------------------

/** Acción de cierre de una fase. Devuelve false si la fase no puede cerrarse aún. */
async function runCloseAction(
  tx: Transaction,
  event: EventRow,
  phase: PhaseRow,
  actorId: string | null,
  now: Date,
  actions: TickAction[],
): Promise<boolean> {
  switch (phase.key) {
    case "registration":
      return executeDraw(tx, event, actorId, now, actions);
    // TODO(hito 6): aplicar on_miss de proposals / selection.
    default:
      return true;
  }
}

async function closePhase(
  tx: Transaction,
  event: EventRow,
  phase: PhaseRow,
  actorId: string | null,
  now: Date,
  actions: TickAction[],
): Promise<boolean> {
  if (!(await runCloseAction(tx, event, phase, actorId, now, actions))) return false;
  await tx
    .update(eventPhases)
    .set({ status: "closed", executedAt: now })
    .where(eq(eventPhases.id, phase.id));
  phase.status = "closed";
  phase.executedAt = now;
  await writeAudit(tx, {
    actorId,
    action: "phase.close",
    entity: "event_phase",
    entityId: phase.id,
    after: { eventId: event.id, phase: phase.key, executedAt: now },
  });
  actions.push({ type: "phase.close", eventId: event.id, phase: phase.key });
  return true;
}

async function openPhase(
  tx: Transaction,
  event: EventRow,
  phase: PhaseRow,
  actions: TickAction[],
): Promise<void> {
  await tx.update(eventPhases).set({ status: "open" }).where(eq(eventPhases.id, phase.id));
  phase.status = "open";
  actions.push({ type: "phase.open", eventId: event.id, phase: phase.key });
}

/**
 * Recorre las fases habilitadas en orden: abre la que ya empezó, cierra la que
 * venció (si tiene avance automático) y sigue con la siguiente. Se detiene en
 * la primera fase que todavía no termina, que espera avance manual o cuya
 * acción de cierre no pudo completarse.
 */
async function advance(
  tx: Transaction,
  event: EventRow,
  phases: PhaseRow[],
  now: Date,
  actions: TickAction[],
): Promise<void> {
  for (const phase of phases) {
    if (event.paused || event.archived) return;
    if (!phase.enabled || phase.status === "closed") continue;

    if (phase.status === "pending") {
      if (phase.startsAt > now) return;
      await openPhase(tx, event, phase, actions);
    }

    if (phase.endsAt >= now) return;
    if (!phase.autoAdvance) {
      actions.push({ type: "phase.waiting_manual", eventId: event.id, phase: phase.key });
      return;
    }
    if (!(await closePhase(tx, event, phase, null, now, actions))) return;
  }
}

async function lockEvent(tx: Transaction, eventId: string) {
  const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for("update");
  if (!event) return null;
  const phases = await tx
    .select()
    .from(eventPhases)
    .where(eq(eventPhases.eventId, eventId))
    .orderBy(asc(eventPhases.position))
    .for("update");
  return { event, phases };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export async function runDueActions(db: Database, now: Date = new Date()): Promise<TickAction[]> {
  const candidates = await db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.paused, false), eq(events.archived, false)));

  const actions: TickAction[] = [];
  for (const { id } of candidates) {
    await db.transaction(async (tx) => {
      const locked = await lockEvent(tx, id);
      if (!locked) return;
      await advance(tx, locked.event, locked.phases, now, actions);
    });
  }
  // TODO(hito 5): encolar recordatorios y procesar el lote de DMs pendientes.
  return actions;
}

/**
 * ¿Hay algo que hacer? Consulta barata para la evaluación perezosa: una fase
 * pendiente cuyo inicio pasó, o una fase abierta vencida con avance automático.
 */
export async function hasDueActions(db: Database, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ id: eventPhases.id })
    .from(eventPhases)
    .innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(
      and(
        eq(events.paused, false),
        eq(events.archived, false),
        eq(eventPhases.enabled, true),
        or(
          and(eq(eventPhases.status, "pending"), lte(eventPhases.startsAt, now)),
          and(
            eq(eventPhases.status, "open"),
            eq(eventPhases.autoAdvance, true),
            isNull(eventPhases.executedAt),
            lt(eventPhases.endsAt, now),
          ),
        ),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Evaluación perezosa (spec §15): corre el tick solo si hay algo vencido. */
export async function ensureTicked(db: Database, now: Date = new Date()): Promise<void> {
  if (await hasDueActions(db, now)) await runDueActions(db, now);
}

/**
 * Panel: cierra ahora la fase en curso (la primera habilitada sin cerrar),
 * ejecutando su acción de cierre aunque no haya llegado su fecha. Para la
 * inscripción equivale a "sortear ahora".
 */
export async function closePhaseNow(
  db: Database,
  actorId: string,
  eventId: string,
  key: PhaseKey,
  now: Date = new Date(),
): Promise<TickAction[]> {
  return db.transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    if (!locked) throw new FlowError("La edición no existe");
    const { event, phases } = locked;
    if (event.archived) throw new FlowError("La edición está archivada");
    if (event.paused) throw new FlowError("La edición está en pausa; reanúdala primero");

    const current = phases.find((p) => p.enabled && p.status !== "closed");
    if (!current || current.key !== key) {
      throw new FlowError(
        current
          ? `Solo se puede cerrar la fase en curso (${PHASE_LABEL[current.key]})`
          : "Todas las fases ya están cerradas",
      );
    }
    if (current.status !== "open") {
      throw new FlowError(`${PHASE_LABEL[current.key]} todavía no abre`);
    }

    const actions: TickAction[] = [];
    await writeAudit(tx, {
      actorId,
      action: "phase.force_close",
      entity: "event_phase",
      entityId: current.id,
      after: { eventId, phase: current.key, scheduledEnd: current.endsAt },
    });
    const closed = await closePhase(tx, event, current, actorId, now, actions);
    if (closed) await advance(tx, event, phases, now, actions);
    return actions;
  });
}

/**
 * Repite el sorteo (spec §9): bloqueado salvo confirmación explícita y solo
 * mientras nadie haya propuesto. Las asignaciones previas quedan marcadas con
 * `superseded_by` apuntando a la nueva asignación del mismo giver.
 */
export async function redraw(
  db: Database,
  actorId: string,
  eventId: string,
  options: { confirm: boolean },
): Promise<{ participants: number }> {
  if (!options.confirm) throw new FlowError("Confirma que quieres repetir el sorteo");

  return db.transaction(async (tx) => {
    const locked = await lockEvent(tx, eventId);
    if (!locked) throw new FlowError("La edición no existe");
    const { event } = locked;
    if (!event.drawExecutedAt) throw new FlowError("Todavía no hay sorteo que repetir");

    const current = await tx
      .select()
      .from(assignments)
      .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)))
      .for("update");

    if (current.length > 0) {
      const [proposal] = await tx
        .select({ id: proposals.id })
        .from(proposals)
        .where(
          inArray(
            proposals.assignmentId,
            current.map((a) => a.id),
          ),
        )
        .limit(1);
      if (proposal) throw new FlowError("Ya hay propuestas; no se puede repetir el sorteo");
    }

    const ids = await activeParticipantIds(tx, eventId);
    if (ids.length < MIN_PARTICIPANTS) {
      throw new FlowError(`Se necesitan al menos ${MIN_PARTICIPANTS} participantes activos`);
    }

    const seed = newSeed();
    const pairs = drawPairs(ids, seed).map((pair) => ({ ...pair, id: crypto.randomUUID() }));
    const newIdByGiver = new Map(pairs.map((pair) => [pair.giverId, pair.id]));

    // 1) Marcar las vigentes como reemplazadas (la FK se verifica al commit).
    //    Si un giver ya no está activo no tiene asignación nueva; su fila vieja
    //    apunta a la primera nueva solo para quedar marcada como reemplazada.
    const fallbackId = pairs[0].id;
    for (const old of current) {
      await tx
        .update(assignments)
        .set({ supersededBy: newIdByGiver.get(old.giverId) ?? fallbackId })
        .where(eq(assignments.id, old.id));
    }
    // 2) Insertar las nuevas.
    await tx.insert(assignments).values(pairs.map((pair) => ({ ...pair, eventId })));
    await tx
      .update(events)
      .set({ drawSeed: seed, drawExecutedAt: new Date() })
      .where(eq(events.id, eventId));

    await writeAudit(tx, {
      actorId,
      action: "draw.repeat",
      entity: "event",
      entityId: eventId,
      before: { seed: event.drawSeed, assignments: current.length },
      after: { seed, participants: ids.length },
    });
    return { participants: ids.length };
  });
}

/** Resumen sin pares (respeta el anonimato) para el panel. */
export async function drawSummary(db: Database, eventId: string) {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${assignments.supersededBy} is null)::int`,
      superseded: sql<number>`count(*) filter (where ${assignments.supersededBy} is not null)::int`,
    })
    .from(assignments)
    .where(eq(assignments.eventId, eventId));
  return row;
}
