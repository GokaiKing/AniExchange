import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, eventPhases, events, evidence, notificationLog, participants, proposals, user } from "@/db/schema";
import { addDays, todayAppDate } from "@/lib/dates";
import type { DmSender } from "@/lib/discord";
import { addParticipants, createTestDb, hasTestDb, resetDb } from "../../tests/db";
import { getMyAssignmentView } from "./assignment-views";
import { createEvent } from "./events";
import { listFeed } from "./evidence";
import { processNotificationBatch } from "./notifications";
import { listAudit } from "./audit-log";
import { eventIsRevealed, pairingsForSuperadmin, PairingsHiddenError, revealSummary } from "./reveal";
import { runDueActions } from "./tick";

describe.skipIf(!hasTestDb)("reveal (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const hour = 3600 * 1000;
  let eventId: string;

  const nameOf = async (participantId: string) =>
    (
      await db
        .select({ name: user.name })
        .from(participants)
        .innerJoin(user, eq(user.id, participants.userId))
        .where(eq(participants.id, participantId))
    )[0].name;
  const userIdOf = async (participantId: string) =>
    (await db.select().from(participants).where(eq(participants.id, participantId)))[0].userId;
  const active = () =>
    db.select().from(assignments).where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)));

  beforeEach(async () => {
    await resetDb(db);
    const event = await createEvent(db, null, { name: "Intercambio", year: 2026, startDate: addDays(todayAppDate(now), -20) });
    eventId = event.id;
    await addParticipants(db, eventId, 4);
    await runDueActions(db, now);
    // Cada asignación con su anime elegido; una con review.
    for (const [i, a] of (await active()).entries()) {
      await db.insert(proposals).values({ assignmentId: a.id, title: `Anime ${i}`, sourceUrl: `https://anilist.co/anime/${i}`, chosen: true });
      if (i === 0) await db.insert(evidence).values({ assignmentId: a.id, reviewText: "Muy buena, la recomiendo a todos.", rating: "9.0" });
    }
    // Todo cerrado; reveal empieza ya.
    await db.update(eventPhases).set({ status: "closed" }).where(eq(eventPhases.eventId, eventId));
    await db
      .update(eventPhases)
      .set({ status: "pending", startsAt: new Date(now.getTime() - hour), endsAt: new Date(now.getTime() + 24 * hour) })
      .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, "reveal")));
  });

  afterAll(async () => {
    await close?.();
  });

  it("antes del reveal no se expone al giver en ningún lado", async () => {
    expect(await eventIsRevealed(db, eventId)).toBe(false);
    const [item] = await listFeed(db, eventId, { revealed: false });
    expect(item).not.toHaveProperty("giver");
    await expect(revealSummary(db, eventId)).rejects.toThrow(/todavía no/);

    const [a] = await active();
    const view = await getMyAssignmentView(db, await userIdOf(a.receiverId));
    if (view.state !== "drawn") throw new Error("debería estar sorteado");
    expect(view.asReceiver).not.toHaveProperty("giver");
  });

  it("al abrir el reveal: DMs para todos y el giver aparece donde corresponde", async () => {
    const actions = await runDueActions(db, now);
    expect(actions).toContainEqual(expect.objectContaining({ type: "phase.open", phase: "reveal" }));
    expect(await eventIsRevealed(db, eventId)).toBe(true);

    const dms = await db.select().from(notificationLog).where(eq(notificationLog.kind, "reveal"));
    expect(dms).toHaveLength(4);

    // Feed con giver correcto.
    const [reviewed] = await listFeed(db, eventId, { revealed: true });
    const assignmentOfReview = (await db.select().from(evidence))[0].assignmentId;
    const [withReview] = await db.select().from(assignments).where(eq(assignments.id, assignmentOfReview));
    expect(reviewed.giver?.name).toBe(await nameOf(withReview.giverId));

    // Mi asignación del receptor.
    const view = await getMyAssignmentView(db, await userIdOf(withReview.receiverId));
    if (view.state !== "drawn") throw new Error("debería estar sorteado");
    expect(view.asReceiver?.giver?.name).toBe(await nameOf(withReview.giverId));

    // Resumen en orden de ciclo: cada receptor es el giver del siguiente.
    const pairs = await revealSummary(db, eventId);
    expect(pairs).toHaveLength(4);
    for (let i = 1; i < pairs.length; i++) expect(pairs[i].giver.name).toBe(pairs[i - 1].receiver.name);
    expect(pairs.find((p) => p.assignmentId === withReview.id)).toMatchObject({ rating: 9, hasReview: true });
  });

  it("el DM de reveal dice quién te regaló y qué diste", async () => {
    await runDueActions(db, now);
    // Los DMs de asignación del sorteo ya habrían salido antes.
    await db.update(notificationLog).set({ status: "sent" }).where(eq(notificationLog.kind, "assignment"));
    const sent: { discordId: string; content: string }[] = [];
    const sender: DmSender = async (discordId, content) => {
      sent.push({ discordId, content });
      return { ok: true };
    };
    await processNotificationBatch(db, { sender, appBaseUrl: "https://ejemplo.test", pauseMs: 0 }, now);
    expect(sent).toHaveLength(4);

    const [a] = await active();
    const [receiver] = await db
      .select({ discordId: user.discordId })
      .from(participants)
      .innerJoin(user, eq(user.id, participants.userId))
      .where(eq(participants.id, a.receiverId));
    const message = sent.find((m) => m.discordId === receiver.discordId)!.content;
    expect(message).toContain(`**${await nameOf(a.giverId)}** te regaló`);
    expect(message).toContain("Tú le diste");
    expect(message).toContain("https://ejemplo.test/reveal");
  });

  describe("emparejamientos para el superadmin", () => {
    it("ocultos por defecto; con el interruptor se ven y cada consulta se audita", async () => {
      const [admin] = await db.insert(user).values({
        id: "admin-x",
        name: "Admin",
        email: "1@discord.invalid",
        discordId: "1",
        role: "superadmin",
      }).returning();
      await expect(pairingsForSuperadmin(db, admin.id, eventId)).rejects.toBeInstanceOf(PairingsHiddenError);

      await db.update(events).set({ adminCanSeePairings: true }).where(eq(events.id, eventId));
      expect(await pairingsForSuperadmin(db, admin.id, eventId)).toHaveLength(4);
      await pairingsForSuperadmin(db, admin.id, eventId);

      const { rows } = await listAudit(db, { action: "pairings.view" });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ actorName: "Admin", entityId: eventId });
    });
  });
});

