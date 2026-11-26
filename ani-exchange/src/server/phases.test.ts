import { describe, expect, it } from "vitest";
import { dayEndUtc, dayStartUtc, toAppDate } from "@/lib/dates";
import {
  defaultPhasePlan,
  parseReminderDays,
  PHASE_ORDER,
  type PhasePlanItem,
  type StoredPhase,
  validatePhasePlan,
} from "./phases";

const plan = () => defaultPhasePlan("2026-12-01");

function edit(items: PhasePlanItem[], key: string, patch: Partial<PhasePlanItem>) {
  return items.map((item) => (item.key === key ? { ...item, ...patch } : item));
}

function errorsOf(items: PhasePlanItem[], options?: Parameters<typeof validatePhasePlan>[1]) {
  const result = validatePhasePlan(items, options);
  return result.ok ? [] : result.errors;
}

describe("defaultPhasePlan", () => {
  it("genera las 6 fases consecutivas sin huecos ni traslapes", () => {
    const items = plan();
    expect(items.map((item) => item.key)).toEqual(PHASE_ORDER);
    expect(toAppDate(items[0].startsAt)).toBe("2026-12-01");
    expect(toAppDate(items[0].endsAt)).toBe("2026-12-14");
    expect(toAppDate(items[1].startsAt)).toBe("2026-12-15");
    for (let i = 1; i < items.length; i++) {
      expect(items[i].startsAt.getTime() - items[i - 1].endsAt.getTime()).toBe(1);
    }
  });

  it("pone las políticas on_miss por defecto solo donde aplican", () => {
    const byKey = Object.fromEntries(plan().map((item) => [item.key, item.onMiss]));
    expect(byKey).toMatchObject({
      registration: null,
      proposals: "random_from_ptw",
      selection: "random_option",
      reveal: null,
    });
  });

  it("es válido", () => {
    expect(validatePhasePlan(plan())).toEqual({ ok: true });
  });
});

describe("validatePhasePlan", () => {
  it("exige las 6 fases en orden", () => {
    const items = plan();
    [items[1], items[2]] = [items[2], items[1]];
    expect(errorsOf(items)[0].message).toMatch(/en orden/);
    expect(errorsOf(plan().slice(0, 5))[0].message).toMatch(/en orden/);
  });

  it("rechaza ends_at <= starts_at", () => {
    const items = edit(plan(), "selection", { endsAt: dayStartUtc("2026-12-01") });
    expect(errorsOf(items)).toContainEqual({ key: "selection", message: expect.stringMatching(/posterior/) });
  });

  it("rechaza traslapes entre fases habilitadas", () => {
    // proposals empieza el último día de registration
    const items = edit(plan(), "proposals", { startsAt: dayStartUtc("2026-12-14") });
    expect(errorsOf(items)).toContainEqual({
      key: "proposals",
      message: expect.stringMatching(/antes de que termine Inscripción/),
    });
  });

  it("ignora traslapes con fases deshabilitadas", () => {
    let items = edit(plan(), "proposals", { enabled: false });
    // selection traslapa con proposals (deshabilitada) pero no con registration
    items = edit(items, "selection", { startsAt: dayStartUtc("2026-12-16") });
    expect(errorsOf(items)).toEqual([]);
  });

  it("no permite desactivar la inscripción", () => {
    const items = edit(plan(), "registration", { enabled: false });
    expect(errorsOf(items)).toContainEqual({ key: "registration", message: expect.any(String) });
  });

  it("valida on_miss según la fase", () => {
    expect(errorsOf(edit(plan(), "proposals", { onMiss: "first_option" }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "selection", { onMiss: null }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "watching", { onMiss: "mark_no_show" }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "proposals", { onMiss: "reassign" }))).toEqual([]);
  });

  it("valida los recordatorios", () => {
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [0] }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [1.5] }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [3, 3] }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [1, 2, 3, 4, 5, 6] }))).toHaveLength(1);
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [] }))).toEqual([]);
    expect(errorsOf(edit(plan(), "proposals", { reminderDays: [7, 3, 1] }))).toEqual([]);
  });

  describe("fases cerradas", () => {
    const current: StoredPhase[] = plan().map((item) => ({
      ...item,
      status: item.key === "registration" ? "closed" : "pending",
    }));

    it("guardar sin cambios en la fase cerrada no pide confirmación", () => {
      const next = edit(plan(), "proposals", { endsAt: dayEndUtc("2026-12-20") });
      expect(validatePhasePlan(next, { current })).toEqual({ ok: true });
    });

    it("editar una fase cerrada exige confirmación", () => {
      const next = edit(plan(), "registration", { reminderDays: [2] });
      const result = validatePhasePlan(next, { current });
      expect(result).toMatchObject({ ok: false, needsClosedConfirmation: true });
      expect(validatePhasePlan(next, { current, confirmClosedEdit: true })).toEqual({ ok: true });
    });
  });
});

describe("parseReminderDays", () => {
  it("parsea y ordena descendente", () => {
    expect(parseReminderDays("1, 7,3")).toEqual([7, 3, 1]);
    expect(parseReminderDays("")).toEqual([]);
  });

  it("rechaza texto no numérico", () => {
    expect(parseReminderDays("1, dos")).toBeNull();
    expect(parseReminderDays("-1")).toBeNull();
  });
});
