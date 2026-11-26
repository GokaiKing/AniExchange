"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { dayEndUtc, dayStartUtc, isIsoDate } from "@/lib/dates";
import { REDRAW_CONFIRMATION } from "@/lib/flow";
import type { PhaseKey } from "@/db/schema";
import {
  createEvent,
  EventInputError,
  setEventFlags,
  updatePhases,
} from "@/server/events";
import {
  hasOnMiss,
  PHASE_LABEL,
  PHASE_ORDER,
  type PhaseError,
  type PhasePlanItem,
  parseReminderDays,
} from "@/server/phases";
import { dmOptionsFromEnv } from "@/server/dm-config";
import {
  enqueueReminders,
  processNotificationBatch,
  resendNotification,
} from "@/server/notifications";
import {
  closePhaseNow,
  FlowError,
  redraw,
  runDueActions,
  type TickAction,
} from "@/server/tick";

const isoDate = z.string().refine(isIsoDate, "Fecha inválida");

// ---------------------------------------------------------------------------
// Crear edición
// ---------------------------------------------------------------------------

const createSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fresh"),
    name: z.string().trim().min(1, "Ponle nombre").max(100),
    year: z.coerce.number().int().min(2000).max(2100),
    startDate: isoDate,
  }),
  z.object({
    mode: z.literal("clone"),
    name: z.string().trim().min(1, "Ponle nombre").max(100),
    year: z.coerce.number().int().min(2000).max(2100),
    cloneFromEventId: z.uuid("Elige la edición a clonar"),
  }),
]);

export type CreateEventState = { error?: string };

export async function createEventAction(
  _prev: CreateEventState,
  formData: FormData,
): Promise<CreateEventState> {
  const user = await assertRole("superadmin");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  let eventId: string;
  try {
    const input = parsed.data;
    const event = await createEvent(getDb(), user.id, {
      name: input.name,
      year: input.year,
      startDate: input.mode === "fresh" ? input.startDate : null,
      cloneFromEventId: input.mode === "clone" ? input.cloneFromEventId : null,
    });
    eventId = event.id;
  } catch (error) {
    if (error instanceof EventInputError) return { error: error.message };
    throw error;
  }
  redirect(`/admin/events/${eventId}`);
}

// ---------------------------------------------------------------------------
// Editar fases
// ---------------------------------------------------------------------------

/** Lo que el editor manda por fase (todo como texto, igual que un form). */
export type PhaseInput = {
  key: string;
  enabled: boolean;
  start: string;
  end: string;
  autoAdvance: boolean;
  onMiss: string;
  reminders: string;
};

export type UpdatePhasesState = {
  ok?: boolean;
  errors?: PhaseError[];
  needsClosedConfirmation?: boolean;
};

function toPlan(rows: PhaseInput[]): { plan?: PhasePlanItem[]; errors: PhaseError[] } {
  const errors: PhaseError[] = [];
  if (rows.length !== PHASE_ORDER.length || rows.some((row, i) => row.key !== PHASE_ORDER[i])) {
    return { errors: [{ message: "Formulario de fases inválido" }] };
  }

  const plan = PHASE_ORDER.map((key, i) => {
    const row = rows[i];
    const label = PHASE_LABEL[key];
    if (!isIsoDate(row.start)) errors.push({ key, message: `${label}: fecha de inicio inválida` });
    if (!isIsoDate(row.end)) errors.push({ key, message: `${label}: fecha de fin inválida` });
    const reminderDays = parseReminderDays(row.reminders);
    if (!reminderDays) {
      errors.push({ key, message: `${label}: recordatorios deben ser números separados por comas` });
    }
    if (!isIsoDate(row.start) || !isIsoDate(row.end) || !reminderDays) return null;

    return {
      key,
      enabled: row.enabled,
      startsAt: dayStartUtc(row.start),
      endsAt: dayEndUtc(row.end),
      autoAdvance: row.autoAdvance,
      onMiss: hasOnMiss(key) ? row.onMiss || null : null,
      reminderDays,
    } satisfies PhasePlanItem;
  });

  return errors.length > 0 ? { errors } : { plan: plan as PhasePlanItem[], errors };
}

export async function updatePhasesAction(
  eventId: string,
  rows: PhaseInput[],
  confirmClosedEdit: boolean,
): Promise<UpdatePhasesState> {
  const user = await assertRole("superadmin");
  if (!z.uuid().safeParse(eventId).success) return { errors: [{ message: "Edición inválida" }] };

  const { plan, errors } = toPlan(rows);
  if (!plan) return { errors };

  const result = await updatePhases(getDb(), user.id, eventId, plan, { confirmClosedEdit });
  if (!result.ok) {
    return { errors: result.errors, needsClosedConfirmation: result.needsClosedConfirmation };
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pausar / archivar
// ---------------------------------------------------------------------------

const flagsSchema = z.object({
  eventId: z.uuid(),
  flag: z.enum(["paused", "archived"]),
  value: z.enum(["true", "false"]),
});

export async function setEventFlagAction(formData: FormData): Promise<void> {
  const user = await assertRole("superadmin");
  const { eventId, flag, value } = flagsSchema.parse(Object.fromEntries(formData));
  await setEventFlags(getDb(), user.id, eventId, { [flag]: value === "true" });
  refresh();
}

// ---------------------------------------------------------------------------
// Flujo: tick manual, cerrar fase ahora, repetir sorteo
// ---------------------------------------------------------------------------

export type FlowState = { ok?: boolean; message?: string; error?: string };

function describeActions(actions: TickAction[]): string {
  if (actions.length === 0) return "No había nada pendiente.";
  return actions
    .map((a) => {
      switch (a.type) {
        case "phase.open":
          return `Se abrió ${PHASE_LABEL[a.phase]}`;
        case "phase.close":
          return `Se cerró ${PHASE_LABEL[a.phase]}`;
        case "phase.waiting_manual":
          return `${PHASE_LABEL[a.phase]} venció y espera avance manual`;
        case "draw.execute":
          return `Sorteo ejecutado (${a.participants} participantes)`;
        case "draw.insufficient":
          return `Sorteo no ejecutado: solo ${a.participants} participantes; edición pausada`;
      }
    })
    .join(" · ");
}

export async function runTickAction(): Promise<FlowState> {
  await assertRole("superadmin");
  const actions = await runDueActions(getDb());
  refresh();
  return { ok: true, message: describeActions(actions) };
}

const phaseKeySchema = z.enum(PHASE_ORDER as [PhaseKey, ...PhaseKey[]]);

export async function closePhaseNowAction(
  eventId: string,
  key: string,
  confirmed: boolean,
): Promise<FlowState> {
  const user = await assertRole("superadmin");
  if (!confirmed) return { error: "Marca la casilla de confirmación" };
  const parsedKey = phaseKeySchema.safeParse(key);
  if (!z.uuid().safeParse(eventId).success || !parsedKey.success) {
    return { error: "Datos inválidos" };
  }
  try {
    const actions = await closePhaseNow(getDb(), user.id, eventId, parsedKey.data);
    refresh();
    return { ok: true, message: describeActions(actions) };
  } catch (error) {
    if (error instanceof FlowError) return { error: error.message };
    throw error;
  }
}

export async function redrawAction(eventId: string, confirmation: string): Promise<FlowState> {
  const user = await assertRole("superadmin");
  if (!z.uuid().safeParse(eventId).success) return { error: "Edición inválida" };
  try {
    const result = await redraw(getDb(), user.id, eventId, {
      confirm: confirmation.trim() === REDRAW_CONFIRMATION,
    });
    refresh();
    return { ok: true, message: `Sorteo repetido (${result.participants} participantes)` };
  } catch (error) {
    if (error instanceof FlowError) return { error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// DMs
// ---------------------------------------------------------------------------

export async function processDmsAction(): Promise<FlowState> {
  await assertRole("superadmin");
  const dm = dmOptionsFromEnv();
  if (!dm) return { error: "Falta DISCORD_BOT_TOKEN: no se pueden enviar DMs" };
  const db = getDb();
  await enqueueReminders(db);
  const result = await processNotificationBatch(db, dm);
  refresh();
  const parts = [`${result.sent} enviados`];
  if (result.retrying) parts.push(`${result.retrying} se reintentarán`);
  if (result.failed) parts.push(`${result.failed} fallaron`);
  if (result.skipped) parts.push(`${result.skipped} omitidos`);
  if (result.rateLimited) parts.push("Discord pidió esperar; el resto sale en el próximo tick");
  return { ok: true, message: parts.join(" · ") };
}

export async function resendDmAction(notificationId: string): Promise<FlowState> {
  const user = await assertRole("superadmin");
  if (!z.uuid().safeParse(notificationId).success) return { error: "DM inválido" };
  const ok = await resendNotification(getDb(), user.id, notificationId);
  refresh();
  return ok ? { ok: true, message: "En cola de nuevo" } : { error: "Ese DM ya no se puede reenviar" };
}
