import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, eventPhases } from "@/db/schema";
import { dayEndUtc, dayStartUtc, toAppDate } from "@/lib/dates";
import { createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import {
  createEvent,
  EventInputError,
  getEventWithPhases,
  setEventFlags,
  updatePhases,
} from "./events";
import type { PhasePlanItem } from "./phases";

describe.skipIf(!hasTestDb)("events (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  let actorId: string;

  beforeEach(async () => {
    await resetDb(db);
    actorId = (await createUser(db)).id;
  });

  afterAll(async () => {
    await close?.();
  });

  async function planOf(eventId: string): Promise<PhasePlanItem[]> {
    const data = await getEventWithPhases(db, eventId);
    return data!.phases.map((p) => ({
      key: p.key,
      enabled: p.enabled,
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      autoAdvance: p.autoAdvance,
      onMiss: p.onMiss,
      reminderDays: p.reminderDays,
    }));
  }

  it("crea una edición con sus 6 fases y la audita", async () => {
    const event = await createEvent(db, actorId, {
      name: "Intercambio 2026",
      year: 2026,
      startDate: "2026-12-01",
    });
    const data = await getEventWithPhases(db, event.id);
    expect(data!.phases).toHaveLength(6);
    expect(data!.phases.every((p) => p.status === "pending")).toBe(true);
    // Guardado en UTC: fin de inscripción = 14 dic 23:59:59.999 Hermosillo
    expect(data!.phases[0].endsAt.toISOString()).toBe("2026-12-15T06:59:59.999Z");

    const audits = await db.select().from(auditLog);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "event.create", actorId, entityId: event.id });
  });

  it("exige fecha de inicio o edición a clonar", async () => {
    await expect(createEvent(db, actorId, { name: "X", year: 2026 })).rejects.toBeInstanceOf(
      EventInputError,
    );
  });

  it("clona reglas y fechas desplazadas al año nuevo", async () => {
    const source = await createEvent(db, actorId, {
      name: "Intercambio 2026",
      year: 2026,
      startDate: "2026-12-01",
    });
    const plan = (await planOf(source.id)).map((item) =>
      item.key === "selection" ? { ...item, onMiss: "mark_no_show", reminderDays: [3, 1] } : item,
    );
    expect(await updatePhases(db, actorId, source.id, plan)).toEqual({ ok: true });

    const clone = await createEvent(db, actorId, {
      name: "Intercambio 2027",
      year: 2027,
      cloneFromEventId: source.id,
    });
    const cloned = await getEventWithPhases(db, clone.id);
    expect(toAppDate(cloned!.phases[0].startsAt)).toBe("2027-12-01");
    expect(cloned!.phases[2]).toMatchObject({ onMiss: "mark_no_show", reminderDays: [3, 1] });
    expect(cloned!.phases.every((p) => p.status === "pending")).toBe(true);
  });

  it("actualiza fechas y audita solo las fases que cambiaron", async () => {
    const event = await createEvent(db, actorId, { name: "E", year: 2026, startDate: "2026-12-01" });
    const plan = (await planOf(event.id)).map((item) =>
      item.key === "registration" ? { ...item, endsAt: dayEndUtc("2026-12-10") } : item,
    );
    expect(await updatePhases(db, actorId, event.id, plan)).toEqual({ ok: true });

    const [registration] = await db
      .select()
      .from(eventPhases)
      .where(eq(eventPhases.eventId, event.id))
      .orderBy(asc(eventPhases.position));
    expect(registration.endsAt.toISOString()).toBe("2026-12-11T06:59:59.999Z");

    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "event.phases.update"));
    expect(audit.before).toHaveLength(1);
    expect(audit.after).toHaveLength(1);
  });

  it("guardar sin cambios no genera auditoría", async () => {
    const event = await createEvent(db, actorId, { name: "E", year: 2026, startDate: "2026-12-01" });
    expect(await updatePhases(db, actorId, event.id, await planOf(event.id))).toEqual({ ok: true });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "event.phases.update"));
    expect(audits).toHaveLength(0);
  });

  it("rechaza traslapes sin escribir nada", async () => {
    const event = await createEvent(db, actorId, { name: "E", year: 2026, startDate: "2026-12-01" });
    const plan = (await planOf(event.id)).map((item) =>
      item.key === "proposals" ? { ...item, startsAt: dayStartUtc("2026-12-10") } : item,
    );
    const result = await updatePhases(db, actorId, event.id, plan);
    expect(result.ok).toBe(false);
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "event.phases.update"));
    expect(audits).toHaveLength(0);
  });

  it("editar una fase cerrada requiere confirmación", async () => {
    const event = await createEvent(db, actorId, { name: "E", year: 2026, startDate: "2026-12-01" });
    await db
      .update(eventPhases)
      .set({ status: "closed" })
      .where(eq(eventPhases.key, "registration"));
    const plan = (await planOf(event.id)).map((item) =>
      item.key === "registration" ? { ...item, reminderDays: [2] } : item,
    );
    expect(await updatePhases(db, actorId, event.id, plan)).toMatchObject({
      ok: false,
      needsClosedConfirmation: true,
    });
    expect(
      await updatePhases(db, actorId, event.id, plan, { confirmClosedEdit: true }),
    ).toEqual({ ok: true });
  });

  it("pausa y archiva con auditoría", async () => {
    const event = await createEvent(db, actorId, { name: "E", year: 2026, startDate: "2026-12-01" });
    await setEventFlags(db, actorId, event.id, { paused: true });
    const data = await getEventWithPhases(db, event.id);
    expect(data!.event.paused).toBe(true);
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "event.flags.update"));
    expect(audit).toMatchObject({ before: { paused: false }, after: { paused: true } });
  });
});
