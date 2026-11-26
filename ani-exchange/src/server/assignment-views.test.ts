import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, participants, user } from "@/db/schema";
import { addDays, todayAppDate } from "@/lib/dates";
import { addParticipants, createTestDb, hasTestDb, resetDb } from "../../tests/db";
import { getMyAssignmentView } from "./assignment-views";
import { createEvent } from "./events";
import { runDueActions } from "./tick";

describe.skipIf(!hasTestDb)("Mi asignación (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const today = todayAppDate(now);

  beforeEach(async () => {
    await resetDb(db);
  });

  afterAll(async () => {
    await close?.();
  });

  async function userOf(participantId: string) {
    const [row] = await db
      .select({ userId: participants.userId, name: user.name, discordId: user.discordId })
      .from(participants)
      .innerJoin(user, eq(user.id, participants.userId))
      .where(eq(participants.id, participantId));
    return row;
  }

  it("estados antes del sorteo", async () => {
    expect(await getMyAssignmentView(db, "nadie")).toEqual({ state: "no_event" });
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: today });
    expect((await getMyAssignmentView(db, "nadie")).state).toBe("not_registered");
    const [p] = await addParticipants(db, event.id, 1);
    expect((await getMyAssignmentView(db, (await userOf(p)).userId)).state).toBe("not_drawn");
  });

  it("el giver ve a su receptor; el receptor NO ve nada del giver", async () => {
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -20) });
    const people = await addParticipants(db, event.id, 4);
    await runDueActions(db, now);

    for (const participantId of people) {
      const me = await userOf(participantId);
      const view = await getMyAssignmentView(db, me.userId);
      if (view.state !== "drawn") throw new Error("debería estar sorteado");

      const [mine] = await db.select().from(assignments).where(eq(assignments.giverId, participantId));
      const receiver = await userOf(mine.receiverId);
      expect(view.asGiver?.receiver.name).toBe(receiver.name);

      // La vista del receptor no contiene ninguna clave ni valor del giver.
      const [received] = await db.select().from(assignments).where(eq(assignments.receiverId, participantId));
      const giver = await userOf(received.giverId);
      expect(Object.keys(view.asReceiver!).sort()).toEqual(
        ["assignmentId", "proposalCount", "selectionDeadline"].sort(),
      );
      const serialized = JSON.stringify(view.asReceiver);
      expect(serialized).not.toContain(received.giverId);
      expect(serialized).not.toContain(giver.userId);
      expect(serialized).not.toContain(giver.discordId);
    }
  });
});
