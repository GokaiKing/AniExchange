"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { dayEndUtc, dayStartUtc, isIsoDate } from "@/lib/dates";
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
