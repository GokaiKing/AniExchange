import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, auditLog, evidence, notificationLog, participants, proposals } from "@/db/schema";
import { addDays, todayAppDate } from "@/lib/dates";
import { addParticipants, createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import {
  listParticipants,
  ParticipantActionError,
  removeFromCycle,
  setParticipantStatus,
} from "./admin-participants";
import { createEvent } from "./events";
import { runDueActions } from "./tick";

describe.skipIf(!hasTestDb)("participantes desde el panel (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  let adminId: string;
  let eventId: string;

  beforeEach(async () => {
    await resetDb(db);
    adminId = (await createUser(db, { role: "superadmin" })).id;
  });

  afterAll(async () => {
    await close?.();
  });

  async function drawn(n: number) {
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(todayAppDate(now), -20) });
    eventId = event.id;
    const ids = await addParticipants(db, eventId, n);
    await runDueActions(db, now);
    return ids;
  }
  const active = () =>
    db.select().from(assignments).where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));

  describe("sacar del ciclo", () => {
    it("W → X → R pasa a W → R y todos siguen dando y recibiendo una vez", async () => {
      await drawn(4);
      const before = await active();
      const x = before[0].giverId;
      const w = before.find((a) => a.receiverId === x)!.giverId;
      const r = before.find((a) => a.giverId === x)!.receiverId;

      const { newAssignmentId } = await removeFromCycle(db, adminId, x);

      const after = await active();
      expect(after).toHaveLength(3);
      expect(after.find((a) => a.id === newAssignmentId)).toMatchObject({ giverId: w, receiverId: r });
      expect(after.some((a) => a.giverId === x || a.receiverId === x)).toBe(false);
      expect(new Set(after.map((a) => a.giverId)).size).toBe(3);
      expect(new Set(after.map((a) => a.receiverId)).size).toBe(3);

      const [xRow] = await db.select().from(participants).where(eq(participants.id, x));
      expect(xRow.status).toBe("no_show");

      // DM al nuevo giver, marcado como reasignación.
      const dm = (await db.select().from(notificationLog)).find(
        (n) => (n.payload as { assignmentId?: string }).assignmentId === newAssignmentId,
      );
      expect(dm?.payload).toMatchObject({ reassigned: true });

      const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "participant.remove_from_cycle"));
      expect(audit.actorId).toBe(adminId);
    });

    it("no deja el ciclo con menos de 2 personas", async () => {
      await drawn(3);
      const first = (await active())[0].giverId;
      await removeFromCycle(db, adminId, first);
      const remaining = (await active())[0].giverId;
      await expect(removeFromCycle(db, adminId, remaining)).rejects.toBeInstanceOf(ParticipantActionError);
    });

    it("no aplica antes del sorteo ni dos veces a la misma persona", async () => {
      const event = await createEvent(db, null, { name: "E", year: 2026, startDate: todayAppDate(now) });
      eventId = event.id;
      const [p] = await addParticipants(db, eventId, 1);
      await expect(removeFromCycle(db, adminId, p)).rejects.toThrow(/sorteo/);

      await resetDb(db);
      adminId = (await createUser(db, { role: "superadmin" })).id;
      const ids = await drawn(5);
      await removeFromCycle(db, adminId, ids[0]);
      await expect(removeFromCycle(db, adminId, ids[0])).rejects.toThrow(/ya no está/);
    });
  });

  describe("estado", () => {
    it("marca y reactiva no participó, con auditoría", async () => {
      const [p] = await drawn(3);
      await setParticipantStatus(db, adminId, p, "no_show");
      await setParticipantStatus(db, adminId, p, "active");
      const audits = await db.select().from(auditLog).where(eq(auditLog.action, "participant.status"));
      expect(audits.map((a) => a.after)).toEqual([{ status: "no_show" }, { status: "active" }]);
    });

    it("quitar solo antes del sorteo", async () => {
      const [p] = await drawn(3);
      await expect(setParticipantStatus(db, adminId, p, "withdrawn")).rejects.toThrow(/sacar del ciclo/);
    });

    it("marca quién terminó su anime (subió review)", async () => {
      await drawn(3);
      const [a1, a2, a3] = await active();
      for (const a of [a1, a2]) {
        await db.insert(proposals).values({ assignmentId: a.id, title: "X", sourceUrl: "https://anilist.co/anime/1", chosen: true });
      }
      await db.insert(evidence).values({ assignmentId: a1.id, reviewText: "La terminé y me gustó mucho." });
      const byId = new Map((await listParticipants(db, eventId)).map((p) => [p.id, p.finished]));
      expect(byId.get(a1.receiverId)).toBe(true);
      expect(byId.get(a2.receiverId)).toBe(false);
      expect(byId.get(a3.receiverId)).toBeNull(); // sin anime elegido
    });

    it("la lista no revela a quién le da cada quien", async () => {
      await drawn(3);
      const list = await listParticipants(db, eventId);
      expect(list).toHaveLength(3);
      const pairs = await active();
      const serialized = JSON.stringify(list);
      for (const a of pairs) expect(serialized).not.toContain(a.id);
      expect(list.every((p) => p.assignmentDm?.status === "pending")).toBe(true);
    });
  });
});
