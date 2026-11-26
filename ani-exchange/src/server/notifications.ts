/**
 * Cola de DMs (spec §10) sobre `notification_log`. Cada fila es un DM a un
 * usuario; `dedupe_key` evita duplicados. El texto se arma al enviar, con los
 * datos vigentes. Un DM fallido no bloquea nada: el sitio es la fuente de
 * verdad.
 */
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "@/db";
import {
  assignments,
  eventPhases,
  events,
  evidence,
  notificationLog,
  participants,
  proposals,
  type PhaseKey,
  user,
} from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { dueReminderDay } from "@/lib/dates";
import type { DmSender } from "@/lib/discord";
import { MIN_PARTICIPANTS } from "./draw";
import { PHASE_LABEL } from "./phases";
import {
  assignmentMessage,
  drawInsufficientMessage,
  hasReminderText,
  onMissAlertMessage,
  revealMessage,
  reminderMessage,
} from "./messages";

export const MAX_DM_ATTEMPTS = 3;
export const DEFAULT_DM_BATCH_SIZE = 10;

type Executor = Database | Transaction;

export type NotificationRow = typeof notificationLog.$inferSelect;

export type AssignmentPayload = { assignmentId: string; redraw?: boolean; reassigned?: boolean };
export type ReminderPayload = { phaseId: string; phase: PhaseKey; days: number };
export type DrawInsufficientPayload = { participants: number };
export type OnMissAlertPayload = { type: "on_miss"; phase: PhaseKey; policy: string; count: number };

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

/** Un DM de asignación por giver. Llamar en la misma transacción del sorteo. */
export async function enqueueAssignmentDms(
  tx: Transaction,
  eventId: string,
  assignmentIds: string[],
  options: { redraw?: boolean; reassigned?: boolean } = {},
): Promise<void> {
  if (assignmentIds.length === 0) return;
  const rows = await tx
    .select({ assignmentId: assignments.id, userId: participants.userId })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.giverId))
    .where(inArray(assignments.id, assignmentIds));
  await tx
    .insert(notificationLog)
    .values(
      rows.map((row) => ({
        eventId,
        userId: row.userId,
        kind: "assignment",
        payload: {
          assignmentId: row.assignmentId,
          redraw: Boolean(options.redraw),
          reassigned: Boolean(options.reassigned),
        } satisfies AssignmentPayload,
        dedupeKey: `assignment:${row.assignmentId}`,
      })),
    )
    .onConflictDoNothing({ target: notificationLog.dedupeKey });
}

/** Los DMs pendientes de asignaciones reemplazadas ya no se envían. */
export async function skipAssignmentDms(tx: Transaction, assignmentIds: string[]): Promise<void> {
  if (assignmentIds.length === 0) return;
  await tx
    .update(notificationLog)
    .set({ status: "skipped", lastError: "asignación reemplazada" })
    .where(
      and(
        eq(notificationLog.kind, "assignment"),
        eq(notificationLog.status, "pending"),
        inArray(sql`${notificationLog.payload}->>'assignmentId'`, assignmentIds),
      ),
    );
  await tx
    .update(assignments)
    .set({ dmStatus: "skipped" })
    .where(and(inArray(assignments.id, assignmentIds), eq(assignments.dmStatus, "pending")));
}

/** Aviso a todos los superadmins. */
export async function enqueueAdminAlert(
  tx: Transaction,
  eventId: string,
  kind: string,
  payload: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  const admins = await tx.select({ id: user.id }).from(user).where(eq(user.role, "superadmin"));
  if (admins.length === 0) return;
  await tx
    .insert(notificationLog)
    .values(
      admins.map((admin) => ({
        eventId,
        userId: admin.id,
        kind,
        payload,
        dedupeKey: `${dedupeKey}:${admin.id}`,
      })),
    )
    .onConflictDoNothing({ target: notificationLog.dedupeKey });
}

/** Un DM de reveal a cada participante de una asignación vigente. */
export async function enqueueRevealDms(tx: Transaction, eventId: string): Promise<void> {
  const rows = await tx
    .select({ giverUser: participants.userId, receiverId: assignments.receiverId })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.giverId))
    .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));
  const receiverIds = rows.map((r) => r.receiverId);
  const receivers =
    receiverIds.length === 0
      ? []
      : await tx.select({ userId: participants.userId }).from(participants).where(inArray(participants.id, receiverIds));
  const userIds = [...new Set([...rows.map((r) => r.giverUser), ...receivers.map((r) => r.userId)])];
  if (userIds.length === 0) return;
  await tx
    .insert(notificationLog)
    .values(userIds.map((userId) => ({ eventId, userId, kind: "reveal", dedupeKey: `reveal:${eventId}:${userId}` })))
    .onConflictDoNothing({ target: notificationLog.dedupeKey });
}

/** Usuarios a recordar en cada fase: quienes todavía no cumplen. */
async function reminderTargets(db: Executor, eventId: string, phase: PhaseKey): Promise<string[]> {
  const active = and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy));

  if (phase === "proposals") {
    // Givers sin ninguna propuesta.
    const rows = await db
      .select({ userId: participants.userId })
      .from(assignments)
      .innerJoin(participants, eq(participants.id, assignments.giverId))
      .leftJoin(proposals, eq(proposals.assignmentId, assignments.id))
      .where(and(active, eq(participants.status, "active"), isNull(proposals.id)));
    return rows.map((r) => r.userId);
  }

  if (phase === "selection") {
    // Receptores con propuestas pero sin elegir.
    const rows = await db
      .select({ userId: participants.userId })
      .from(assignments)
      .innerJoin(participants, eq(participants.id, assignments.receiverId))
      .innerJoin(proposals, eq(proposals.assignmentId, assignments.id))
      .where(and(active, eq(participants.status, "active")))
      .groupBy(participants.userId, assignments.id)
      .having(sql`bool_or(${proposals.chosen}) is not true`);
    return rows.map((r) => r.userId);
  }

  if (phase === "evidence") {
    // Receptores sin evidencia.
    const rows = await db
      .select({ userId: participants.userId })
      .from(assignments)
      .innerJoin(participants, eq(participants.id, assignments.receiverId))
      .leftJoin(evidence, eq(evidence.assignmentId, assignments.id))
      .where(and(active, eq(participants.status, "active"), isNull(evidence.id)));
    return rows.map((r) => r.userId);
  }

  return [];
}

/**
 * Encola los recordatorios que tocan hoy (dedupe por fase, día y usuario).
 * Devuelve cuántos se encolaron.
 */
export async function enqueueReminders(db: Database, now: Date = new Date()): Promise<number> {
  const openPhases = await db
    .select({ phase: eventPhases, eventId: events.id })
    .from(eventPhases)
    .innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(
      and(
        eq(events.paused, false),
        eq(events.archived, false),
        eq(eventPhases.enabled, true),
        eq(eventPhases.status, "open"),
      ),
    );

  let enqueued = 0;
  for (const { phase, eventId } of openPhases) {
    if (!hasReminderText(phase.key)) continue;
    const days = dueReminderDay(phase.endsAt, phase.reminderDays, now);
    if (days === null) continue;

    const userIds = [...new Set(await reminderTargets(db, eventId, phase.key))];
    if (userIds.length === 0) continue;
    const inserted = await db
      .insert(notificationLog)
      .values(
        userIds.map((userId) => ({
          eventId,
          userId,
          kind: "reminder",
          payload: { phaseId: phase.id, phase: phase.key, days } satisfies ReminderPayload,
          dedupeKey: `reminder:${phase.id}:${days}:${userId}`,
        })),
      )
      .onConflictDoNothing({ target: notificationLog.dedupeKey })
      .returning({ id: notificationLog.id });
    enqueued += inserted.length;
  }
  return enqueued;
}

// ---------------------------------------------------------------------------
// Armar el texto
// ---------------------------------------------------------------------------

/** Texto del DM, o null si ya no aplica (p. ej. asignación reemplazada). */
async function render(tx: Transaction, row: NotificationRow, appBaseUrl: string): Promise<string | null> {
  const myAssignment = `${appBaseUrl}/assignment`;
  const [event] = row.eventId
    ? await tx.select().from(events).where(eq(events.id, row.eventId))
    : [];
  const eventName = event?.name ?? "Intercambio de anime";

  if (row.kind === "assignment") {
    const { assignmentId, redraw, reassigned } = row.payload as AssignmentPayload;
    const [data] = await tx
      .select({ assignment: assignments, receiver: participants, receiverName: user.name })
      .from(assignments)
      .innerJoin(participants, eq(participants.id, assignments.receiverId))
      .innerJoin(user, eq(user.id, participants.userId))
      .where(eq(assignments.id, assignmentId));
    if (!data || data.assignment.supersededBy) return null;
    const [proposalsPhase] = await tx
      .select({ endsAt: eventPhases.endsAt })
      .from(eventPhases)
      .where(and(eq(eventPhases.eventId, data.assignment.eventId), eq(eventPhases.key, "proposals")));
    return assignmentMessage({
      eventName,
      receiverName: data.receiverName,
      allowedTags: data.receiver.allowedTags,
      bannedTags: data.receiver.bannedTags,
      maxEpisodes: data.receiver.maxEpisodes,
      allowPtw: data.receiver.allowPtw,
      deadline: proposalsPhase?.endsAt ?? null,
      link: myAssignment,
      redraw: Boolean(redraw),
      reassigned: Boolean(reassigned),
    });
  }

  if (row.kind === "reminder") {
    const { phaseId, phase } = row.payload as ReminderPayload;
    const [current] = await tx.select().from(eventPhases).where(eq(eventPhases.id, phaseId));
    if (!current || current.status !== "open") return null;
    return reminderMessage({ eventName, phase, deadline: current.endsAt, link: myAssignment });
  }

  if (row.kind === "reveal" && row.eventId && row.userId) {
    return renderReveal(tx, row.eventId, row.userId, eventName, `${appBaseUrl}/reveal`);
  }

  if (row.kind === "admin_alert" && (row.payload as { type?: string }).type === "on_miss") {
    const { phase, policy, count: n } = row.payload as OnMissAlertPayload;
    return onMissAlertMessage({
      eventName,
      phaseLabel: PHASE_LABEL[phase],
      policy,
      count: n,
      link: `${appBaseUrl}/admin/events/${row.eventId}`,
    });
  }

  if (row.kind === "admin_alert") {
    const { participants: n } = row.payload as DrawInsufficientPayload;
    return drawInsufficientMessage({
      eventName,
      participants: n,
      minimum: MIN_PARTICIPANTS,
      link: `${appBaseUrl}/admin/events/${row.eventId}`,
    });
  }

  return null;
}

async function renderReveal(
  tx: Transaction,
  eventId: string,
  userId: string,
  eventName: string,
  link: string,
): Promise<string | null> {
  const [me] = await tx
    .select({ id: participants.id })
    .from(participants)
    .where(and(eq(participants.eventId, eventId), eq(participants.userId, userId)));
  if (!me) return null;

  const active = and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy));
  const personOf = async (participantId: string) =>
    (
      await tx
        .select({ name: user.name })
        .from(participants)
        .innerJoin(user, eq(user.id, participants.userId))
        .where(eq(participants.id, participantId))
    )[0]?.name ?? "alguien";
  const chosenOf = async (assignmentId: string) =>
    (
      await tx
        .select({ title: proposals.title })
        .from(proposals)
        .where(and(eq(proposals.assignmentId, assignmentId), eq(proposals.chosen, true)))
    )[0]?.title ?? null;

  const [asReceiver] = await tx.select().from(assignments).where(and(active, eq(assignments.receiverId, me.id)));
  const [asGiver] = await tx.select().from(assignments).where(and(active, eq(assignments.giverId, me.id)));

  let received = null;
  if (asReceiver) {
    const title = await chosenOf(asReceiver.id);
    const [mine] = await tx.select({ id: evidence.id }).from(evidence).where(eq(evidence.assignmentId, asReceiver.id));
    if (title) received = { title, giverName: await personOf(asReceiver.giverId), finished: Boolean(mine) };
  }
  let gave = null;
  if (asGiver) {
    const [review] = await tx.select({ rating: evidence.rating }).from(evidence).where(eq(evidence.assignmentId, asGiver.id));
    gave = {
      receiverName: await personOf(asGiver.receiverId),
      title: await chosenOf(asGiver.id),
      rating: review?.rating ? Number(review.rating) : null,
      reviewed: Boolean(review),
    };
  }
  if (!received && !gave) return null;
  return revealMessage({ eventName, received, gave, link });
}

// ---------------------------------------------------------------------------
// Procesar lote
// ---------------------------------------------------------------------------

export type DmProcessingOptions = {
  sender: DmSender;
  appBaseUrl: string;
  batchSize?: number;
  /** Pausa entre mensajes (spec: ~1 s). */
  pauseMs?: number;
};

export type BatchResult = {
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  rateLimited: boolean;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mirrorAssignment(
  tx: Transaction,
  row: NotificationRow,
  values: Partial<typeof assignments.$inferInsert>,
) {
  if (row.kind !== "assignment") return;
  const { assignmentId } = row.payload as AssignmentPayload;
  await tx.update(assignments).set(values).where(eq(assignments.id, assignmentId));
}

/**
 * Envía hasta `batchSize` DMs pendientes. Las filas se toman con
 * FOR UPDATE SKIP LOCKED: dos ticks simultáneos nunca envían la misma.
 */
export async function processNotificationBatch(
  db: Database,
  options: DmProcessingOptions,
  now: Date = new Date(),
): Promise<BatchResult> {
  const result: BatchResult = { sent: 0, retrying: 0, failed: 0, skipped: 0, rateLimited: false };
  const batchSize = options.batchSize ?? DEFAULT_DM_BATCH_SIZE;
  const pauseMs = options.pauseMs ?? 1000;

  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ notification: notificationLog, discordId: user.discordId })
      .from(notificationLog)
      .leftJoin(user, eq(user.id, notificationLog.userId))
      .where(eq(notificationLog.status, "pending"))
      .orderBy(asc(notificationLog.createdAt))
      .limit(batchSize)
      .for("update", { of: notificationLog, skipLocked: true });

    for (let i = 0; i < rows.length; i++) {
      const { notification: row, discordId } = rows[i];
      const content = discordId ? await render(tx, row, options.appBaseUrl) : null;

      if (!content || !discordId) {
        await tx
          .update(notificationLog)
          .set({ status: "skipped", lastError: discordId ? "ya no aplica" : "usuario sin Discord ID" })
          .where(eq(notificationLog.id, row.id));
        await mirrorAssignment(tx, row, { dmStatus: "skipped" });
        result.skipped++;
        continue;
      }

      if (i > 0 && pauseMs > 0) await sleep(pauseMs);
      const sent = await options.sender(discordId, content);

      if (sent.ok) {
        await tx
          .update(notificationLog)
          .set({ status: "sent", attempts: row.attempts + 1, sentAt: now, lastError: null })
          .where(eq(notificationLog.id, row.id));
        await mirrorAssignment(tx, row, {
          dmStatus: "sent",
          dmAttempts: row.attempts + 1,
          dmSentAt: now,
          dmLastError: null,
        });
        result.sent++;
        continue;
      }

      if (sent.kind === "rate_limited") {
        // No cuenta como intento: se reanuda en el próximo tick.
        result.rateLimited = true;
        break;
      }

      const attempts = row.attempts + 1;
      const giveUp = sent.kind === "permanent" || attempts >= MAX_DM_ATTEMPTS;
      await tx
        .update(notificationLog)
        .set({ status: giveUp ? "failed" : "pending", attempts, lastError: sent.error })
        .where(eq(notificationLog.id, row.id));
      await mirrorAssignment(tx, row, {
        dmStatus: giveUp ? "failed" : "pending",
        dmAttempts: attempts,
        dmLastError: sent.error,
      });
      if (giveUp) result.failed++;
      else result.retrying++;
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Vuelve a poner en cola un DM (reinicia intentos). */
export async function resendNotification(
  db: Database,
  actorId: string,
  notificationId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(notificationLog)
      .where(eq(notificationLog.id, notificationId))
      .for("update");
    if (!row || row.status === "pending") return false;
    if (row.kind === "assignment") {
      const { assignmentId } = row.payload as AssignmentPayload;
      const [assignment] = await tx
        .select({ supersededBy: assignments.supersededBy })
        .from(assignments)
        .where(eq(assignments.id, assignmentId));
      if (!assignment || assignment.supersededBy) return false;
    }
    await tx
      .update(notificationLog)
      .set({ status: "pending", attempts: 0, lastError: null })
      .where(eq(notificationLog.id, row.id));
    await mirrorAssignment(tx, row, { dmStatus: "pending", dmAttempts: 0, dmLastError: null });
    await writeAudit(tx, {
      actorId,
      action: "dm.resend",
      entity: "notification",
      entityId: row.id,
      before: { status: row.status, attempts: row.attempts, lastError: row.lastError },
    });
    return true;
  });
}

export async function notificationStats(db: Database, eventId: string) {
  const rows = await db
    .select({ status: notificationLog.status, total: count() })
    .from(notificationLog)
    .where(eq(notificationLog.eventId, eventId))
    .groupBy(notificationLog.status);
  const stats = { pending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) stats[row.status] = row.total;
  return stats;
}

/** DMs que requieren atención o siguen reintentando, con el nombre del destinatario. */
export async function notificationsNeedingAttention(db: Database, eventId: string) {
  return db
    .select({
      id: notificationLog.id,
      kind: notificationLog.kind,
      status: notificationLog.status,
      attempts: notificationLog.attempts,
      lastError: notificationLog.lastError,
      userName: user.name,
    })
    .from(notificationLog)
    .leftJoin(user, eq(user.id, notificationLog.userId))
    .where(
      and(
        eq(notificationLog.eventId, eventId),
        sql`(${notificationLog.status} = 'failed' or (${notificationLog.status} = 'pending' and ${notificationLog.attempts} > 0))`,
      ),
    )
    .orderBy(asc(notificationLog.createdAt));
}
