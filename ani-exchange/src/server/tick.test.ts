import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  assignments,
  auditLog,
  eventPhases,
  events,
  notificationLog,
  proposals,
} from "@/db/schema";
import { addDays, todayAppDate } from "@/lib/dates";
import { addParticipants, createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import { createEvent } from "./events";
import {
  closePhaseNow,
  drawSummary,
  FlowError,
  hasDueActions,
  redraw,
  runDueActions,
} from "./tick";

describe.skipIf(!hasTestDb)("tick y sorteo (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const today = todayAppDate(now);
  let adminId: string;

  beforeEach(async () => {
    await resetDb(db);
    adminId = (await createUser(db, { role: "superadmin" })).id;
  });

  afterAll(async () => {
    await close?.();
  });

  /** Edición cuya inscripción ya venció y cuya fase de propuestas está en curso. */
  async function expiredRegistrationEvent() {
    // registration: hoy-20 … hoy-7; proposals: hoy-6 … hoy
    return createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -20) });
  }

  const phasesOf = (eventId: string) =>
    db
      .select()
      .from(eventPhases)
      .where(eq(eventPhases.eventId, eventId))
      .orderBy(asc(eventPhases.position));

  const activeAssignments = (eventId: string) =>
    db
      .select()
      .from(assignments)
      .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));

  it("al vencer la inscripción: sortea, cierra y abre propuestas", async () => {
    const event = await expiredRegistrationEvent();
    const people = await addParticipants(db, event.id, 5);

    const actions = await runDueActions(db, now);
    expect(actions.map((a) => a.type)).toEqual([
      "phase.open", // registration (nunca se abrió)
      "draw.execute",
      "phase.close",
      "phase.open", // proposals
    ]);

    const rows = await activeAssignments(event.id);
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.giverId))).toEqual(new Set(people));
    expect(rows.every((r) => r.dmStatus === "pending")).toBe(true);

    const [ev] = await db.select().from(events).where(eq(events.id, event.id));
    expect(ev.drawSeed).toMatch(/^[0-9a-f]{64}$/);
    expect(ev.drawExecutedAt).not.toBeNull();

    const phases = await phasesOf(event.id);
    expect(phases[0]).toMatchObject({ key: "registration", status: "closed" });
    expect(phases[0].executedAt).not.toBeNull();
    expect(phases[1]).toMatchObject({ key: "proposals", status: "open" });
    expect(phases[2]).toMatchObject({ key: "selection", status: "pending" });

    // La auditoría no guarda los pares (anonimato).
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "draw.execute"));
    expect(audit.after).toEqual({ seed: ev.drawSeed, participants: 5 });
  });

  it("es idempotente: correrlo de nuevo no hace nada", async () => {
    const event = await expiredRegistrationEvent();
    await addParticipants(db, event.id, 4);
    await runDueActions(db, now);
    expect(await runDueActions(db, now)).toEqual([]);
    expect(await activeAssignments(event.id)).toHaveLength(4);
  });

  it("llamadas en paralelo no duplican el sorteo", async () => {
    const event = await expiredRegistrationEvent();
    await addParticipants(db, event.id, 6);
    await Promise.all(Array.from({ length: 5 }, () => runDueActions(db, now)));

    expect(await activeAssignments(event.id)).toHaveLength(6);
    const draws = await db.select().from(auditLog).where(eq(auditLog.action, "draw.execute"));
    expect(draws).toHaveLength(1);
  });

  it("excluye a quienes se retiraron", async () => {
    const event = await expiredRegistrationEvent();
    const active = await addParticipants(db, event.id, 3);
    await addParticipants(db, event.id, 2, "withdrawn");
    await runDueActions(db, now);
    const rows = await activeAssignments(event.id);
    expect(new Set(rows.map((r) => r.giverId))).toEqual(new Set(active));
  });

  it("con menos de 3 participantes pausa la edición y avisa una sola vez", async () => {
    const event = await expiredRegistrationEvent();
    await addParticipants(db, event.id, 2);

    const actions = await runDueActions(db, now);
    expect(actions.map((a) => a.type)).toContain("draw.insufficient");
    expect(await activeAssignments(event.id)).toHaveLength(0);

    const [ev] = await db.select().from(events).where(eq(events.id, event.id));
    expect(ev.paused).toBe(true);
    expect((await phasesOf(event.id))[0].status).toBe("open"); // no se cerró

    await runDueActions(db, now); // pausada: se omite
    const alerts = await db.select().from(notificationLog);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "admin_alert", userId: adminId, status: "pending" });
  });

  it("abre la inscripción cuando llega su fecha", async () => {
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: today });
    expect(await hasDueActions(db, now)).toBe(true);
    expect(await runDueActions(db, now)).toEqual([
      { type: "phase.open", eventId: event.id, phase: "registration" },
    ]);
    expect(await hasDueActions(db, now)).toBe(false);
  });

  it("no hace nada antes de tiempo", async () => {
    await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, 3) });
    expect(await hasDueActions(db, now)).toBe(false);
    expect(await runDueActions(db, now)).toEqual([]);
  });

  it("respeta el avance manual", async () => {
    const event = await expiredRegistrationEvent();
    await addParticipants(db, event.id, 3);
    await db
      .update(eventPhases)
      .set({ autoAdvance: false })
      .where(and(eq(eventPhases.eventId, event.id), eq(eventPhases.key, "registration")));

    const actions = await runDueActions(db, now);
    expect(actions.map((a) => a.type)).toEqual(["phase.open", "phase.waiting_manual"]);
    expect(await activeAssignments(event.id)).toHaveLength(0);
  });

  it("salta fases deshabilitadas", async () => {
    // registration: hoy-27 … hoy-14, proposals (deshabilitada), selection: hoy-6 … hoy-3, watching: hoy-2 …
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -27) });
    await addParticipants(db, event.id, 3);
    await db
      .update(eventPhases)
      .set({ enabled: false })
      .where(and(eq(eventPhases.eventId, event.id), eq(eventPhases.key, "proposals")));

    await runDueActions(db, now);
    const byKey = Object.fromEntries((await phasesOf(event.id)).map((p) => [p.key, p.status]));
    expect(byKey).toMatchObject({
      registration: "closed",
      proposals: "pending",
      selection: "closed",
      watching: "open",
    });
  });

  it("omite ediciones pausadas o archivadas", async () => {
    const event = await expiredRegistrationEvent();
    await addParticipants(db, event.id, 3);
    await db.update(events).set({ archived: true });
    expect(await hasDueActions(db, now)).toBe(false);
    expect(await runDueActions(db, now)).toEqual([]);
  });

  describe("closePhaseNow", () => {
    it("sortea antes de la fecha de cierre", async () => {
      const event = await createEvent(db, null, { name: "E", year: 2026, startDate: today });
      await addParticipants(db, event.id, 3);
      await runDueActions(db, now); // abre registration

      const actions = await closePhaseNow(db, adminId, event.id, "registration", now);
      expect(actions.map((a) => a.type)).toEqual(["draw.execute", "phase.close"]);
      expect(await activeAssignments(event.id)).toHaveLength(3);
      // proposals empieza en el futuro: sigue pendiente
      expect((await phasesOf(event.id))[1].status).toBe("pending");

      const forced = await db.select().from(auditLog).where(eq(auditLog.action, "phase.force_close"));
      expect(forced[0].actorId).toBe(adminId);
    });

    it("solo permite cerrar la fase en curso", async () => {
      const event = await createEvent(db, null, { name: "E", year: 2026, startDate: today });
      await runDueActions(db, now);
      await expect(closePhaseNow(db, adminId, event.id, "proposals", now)).rejects.toBeInstanceOf(
        FlowError,
      );
    });

    it("no cierra una fase que aún no abre", async () => {
      const event = await createEvent(db, null, {
        name: "E",
        year: 2026,
        startDate: addDays(today, 2),
      });
      await expect(closePhaseNow(db, adminId, event.id, "registration", now)).rejects.toThrow(
        /todavía no abre/,
      );
    });
  });

  describe("redraw", () => {
    async function drawnEvent(n = 5) {
      const event = await expiredRegistrationEvent();
      await addParticipants(db, event.id, n);
      await runDueActions(db, now);
      return event;
    }

    it("exige confirmación", async () => {
      const event = await drawnEvent();
      await expect(redraw(db, adminId, event.id, { confirm: false })).rejects.toThrow(/Confirma/);
    });

    it("reemplaza las asignaciones y deja rastro", async () => {
      const event = await drawnEvent(5);
      const before = await activeAssignments(event.id);
      const [{ drawSeed: oldSeed }] = await db.select().from(events).where(eq(events.id, event.id));

      await redraw(db, adminId, event.id, { confirm: true });

      const after = await activeAssignments(event.id);
      expect(after).toHaveLength(5);
      expect(after.some((a) => before.some((b) => b.id === a.id))).toBe(false);
      expect(await drawSummary(db, event.id)).toEqual({ active: 5, superseded: 5 });

      // Cada vieja apunta a la nueva del mismo giver.
      const old = await db.select().from(assignments).where(eq(assignments.eventId, event.id));
      for (const row of old.filter((r) => r.supersededBy)) {
        const replacement = after.find((a) => a.id === row.supersededBy)!;
        expect(replacement.giverId).toBe(row.giverId);
      }

      const [ev] = await db.select().from(events).where(eq(events.id, event.id));
      expect(ev.drawSeed).not.toBe(oldSeed);
      const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "draw.repeat"));
      expect(audit.actorId).toBe(adminId);
    });

    it("se bloquea si ya hay propuestas", async () => {
      const event = await drawnEvent();
      const [first] = await activeAssignments(event.id);
      await db.insert(proposals).values({
        assignmentId: first.id,
        title: "Cowboy Bebop",
        sourceUrl: "https://anilist.co/anime/1",
      });
      await expect(redraw(db, adminId, event.id, { confirm: true })).rejects.toThrow(/propuestas/);
    });

    it("no hay sorteo que repetir", async () => {
      const event = await createEvent(db, null, { name: "E", year: 2026, startDate: today });
      await expect(redraw(db, adminId, event.id, { confirm: true })).rejects.toThrow(/Todavía no/);
    });
  });
});
