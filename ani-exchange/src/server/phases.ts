import type { PhaseKey, PhaseStatus } from "@/db/schema";
import { addDays, dayEndUtc, dayStartUtc, type IsoDate } from "@/lib/dates";

/**
 * Orden de las fases. "watching" ya no se usa: ver la serie y subir la review
 * son una sola fase ("evidence"), para que cada quien reseñe en cuanto termine.
 * El valor sigue en el enum de Postgres solo por compatibilidad.
 */
export const PHASE_ORDER: readonly PhaseKey[] = [
  "registration",
  "proposals",
  "selection",
  "evidence",
  "reveal",
];

export const PHASE_LABEL: Record<PhaseKey, string> = {
  registration: "Inscripción",
  proposals: "Propuestas",
  selection: "Elección",
  watching: "A ver la serie (obsoleta)",
  evidence: "Ver la serie y reseñar",
  reveal: "Reveal",
};

/** Políticas si alguien no cumple, por fase (spec §6). */
export const ON_MISS_OPTIONS = {
  proposals: ["random_from_ptw", "reassign", "mark_no_show"],
  selection: ["first_option", "random_option", "mark_no_show"],
} as const satisfies Partial<Record<PhaseKey, readonly string[]>>;

export type OnMissPhase = keyof typeof ON_MISS_OPTIONS;

export const ON_MISS_LABEL: Record<string, string> = {
  random_from_ptw: "Elegir al azar de su Plan to Watch",
  reassign: "Reasignar a otro giver",
  mark_no_show: "Marcar como no participó",
  first_option: "Elegir la primera opción",
  random_option: "Elegir una opción al azar",
};

export const DEFAULT_ON_MISS: Record<OnMissPhase, string> = {
  proposals: "random_from_ptw",
  selection: "random_option",
};

/** Duración por defecto de cada fase, en días de calendario. */
export const DEFAULT_DURATION_DAYS: Record<PhaseKey, number> = {
  registration: 14,
  proposals: 7,
  selection: 4,
  watching: 0, // obsoleta
  evidence: 28,
  reveal: 7,
};

export const MAX_REMINDERS = 5;
export const MAX_REMINDER_DAYS = 60;

export function hasOnMiss(key: PhaseKey): key is OnMissPhase {
  return key in ON_MISS_OPTIONS;
}

export type PhasePlanItem = {
  key: PhaseKey;
  enabled: boolean;
  startsAt: Date;
  endsAt: Date;
  autoAdvance: boolean;
  onMiss: string | null;
  reminderDays: number[];
};

/** Estado actual guardado de una fase, para detectar ediciones a fases cerradas. */
export type StoredPhase = PhasePlanItem & { status: PhaseStatus };

export type PhaseError = { key?: PhaseKey; message: string };

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: PhaseError[]; needsClosedConfirmation: boolean };

/** Fases consecutivas a partir de `firstDay`, con las duraciones por defecto. */
export function defaultPhasePlan(firstDay: IsoDate): PhasePlanItem[] {
  let start = firstDay;
  return PHASE_ORDER.map((key) => {
    const end = addDays(start, DEFAULT_DURATION_DAYS[key] - 1);
    const item: PhasePlanItem = {
      key,
      enabled: true,
      startsAt: dayStartUtc(start),
      endsAt: dayEndUtc(end),
      autoAdvance: true,
      onMiss: hasOnMiss(key) ? DEFAULT_ON_MISS[key] : null,
      reminderDays: [1],
    };
    start = addDays(end, 1);
    return item;
  });
}

/** ¿Dos filas del plan son equivalentes (mismas fechas y reglas)? */
export function samePlan(a: PhasePlanItem, b: PhasePlanItem): boolean {
  return (
    a.enabled === b.enabled &&
    a.startsAt.getTime() === b.startsAt.getTime() &&
    a.endsAt.getTime() === b.endsAt.getTime() &&
    a.autoAdvance === b.autoAdvance &&
    a.onMiss === b.onMiss &&
    a.reminderDays.length === b.reminderDays.length &&
    a.reminderDays.every((day, i) => day === b.reminderDays[i])
  );
}

/**
 * Valida un plan completo de fases (spec §6 "Validaciones al guardar").
 * Función pura: no toca la base.
 */
export function validatePhasePlan(
  plan: readonly PhasePlanItem[],
  options: { current?: readonly StoredPhase[]; confirmClosedEdit?: boolean } = {},
): ValidationResult {
  const errors: PhaseError[] = [];

  // Exactamente una fila por fase, en el orden canónico.
  const keys = plan.map((item) => item.key);
  if (keys.length !== PHASE_ORDER.length || keys.some((key, i) => key !== PHASE_ORDER[i])) {
    return {
      ok: false,
      needsClosedConfirmation: false,
      errors: [{ message: `Se esperaban las fases en orden: ${PHASE_ORDER.join(", ")}` }],
    };
  }

  for (const item of plan) {
    if (!(item.endsAt.getTime() > item.startsAt.getTime())) {
      errors.push({ key: item.key, message: "El fin debe ser posterior al inicio" });
    }

    if (hasOnMiss(item.key)) {
      const allowed: readonly string[] = ON_MISS_OPTIONS[item.key];
      if (!item.onMiss || !allowed.includes(item.onMiss)) {
        errors.push({ key: item.key, message: "Elige una política para quien no cumpla" });
      }
    } else if (item.onMiss !== null) {
      errors.push({ key: item.key, message: "Esta fase no admite política de incumplimiento" });
    }

    const days = item.reminderDays;
    if (days.length > MAX_REMINDERS) {
      errors.push({ key: item.key, message: `Máximo ${MAX_REMINDERS} recordatorios` });
    }
    if (days.some((d) => !Number.isInteger(d) || d < 1 || d > MAX_REMINDER_DAYS)) {
      errors.push({
        key: item.key,
        message: `Los recordatorios deben ser días enteros entre 1 y ${MAX_REMINDER_DAYS}`,
      });
    }
    if (new Set(days).size !== days.length) {
      errors.push({ key: item.key, message: "Hay recordatorios repetidos" });
    }
  }

  const registration = plan[0];
  if (!registration.enabled) {
    errors.push({
      key: "registration",
      message: "La inscripción no se puede desactivar (su cierre ejecuta el sorteo)",
    });
  }

  // Sin traslapes entre fases habilitadas consecutivas.
  const enabled = plan.filter((item) => item.enabled);
  for (let i = 1; i < enabled.length; i++) {
    const prev = enabled[i - 1];
    const next = enabled[i];
    if (next.startsAt.getTime() <= prev.endsAt.getTime()) {
      errors.push({
        key: next.key,
        message: `Empieza antes de que termine ${PHASE_LABEL[prev.key]}`,
      });
    }
  }

  // Editar una fase ya cerrada requiere confirmación explícita.
  let needsClosedConfirmation = false;
  if (options.current) {
    for (const item of plan) {
      const stored = options.current.find((phase) => phase.key === item.key);
      if (stored?.status === "closed" && !samePlan(stored, item)) {
        needsClosedConfirmation = true;
        if (!options.confirmClosedEdit) {
          errors.push({
            key: item.key,
            message: "Esta fase ya terminó; confirma que quieres modificarla",
          });
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors, needsClosedConfirmation };
}

/** Normaliza "3, 1,7" → [7, 3, 1] (orden descendente, como se disparan). */
export function parseReminderDays(text: string): number[] | null {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  return parts.map(Number).sort((a, b) => b - a);
}

/**
 * ¿La fase acepta acciones de usuarios ahora mismo?
 * Se decide por fechas (no solo por `status`) para que la fase cierre a tiempo
 * aunque el tick todavía no haya corrido (evaluación perezosa, spec §15).
 */
export function isPhaseActive(
  phase: { enabled: boolean; status: PhaseStatus; startsAt: Date; endsAt: Date },
  event: { paused: boolean; archived: boolean },
  now: Date,
): boolean {
  return (
    !event.paused &&
    !event.archived &&
    phase.enabled &&
    phase.status !== "closed" &&
    phase.startsAt.getTime() <= now.getTime() &&
    now.getTime() <= phase.endsAt.getTime()
  );
}
