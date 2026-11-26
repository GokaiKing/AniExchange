import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, eventPhases, notificationLog, participants, proposals, user } from "@/db/schema";
import { addDays, dayEndUtc, todayAppDate } from "@/lib/dates";
import type { DmSender, SendResult } from "@/lib/discord";
import { addParticipants, createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import { createEvent } from "./events";
import {
  enqueueReminders,
  notificationStats,
  processNotificationBatch,
  resendNotification,
} from "./notifications";
import { redraw, runDueActions } from "./tick";

/** Sender falso que registra lo enviado y responde lo que se le indique. */
function fakeSender(script: (discordId: string, n: number) => SendResult = () => ({ ok: true })) {
  const sent: { discordId: string; content: string }[] = [];
  const sender: DmSender = async (discordId, content) => {
    sent.push({ discordId, content });
    return script(discordId, sent.length);
  };
  return { sender, sent };
}

describe.skipIf(!hasTestDb)("cola de DMs (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const today = todayAppDate(now);
  const appBaseUrl = "https://ejemplo.test";
  let adminId: string;

  beforeEach(async () => {
    await resetDb(db);
    adminId = (await createUser(db, { role: "superadmin" })).id;
  });

  afterAll(async () => {
    await close?.();
  });

  async function drawnEvent(n = 4) {
    const event = await createEvent(db, null, { name: "Intercambio", year: 2026, startDate: addDays(today, -20) });
    await addParticipants(db, event.id, n);
    await runDueActions(db, now);
    return event;
  }

  const process = (sender: DmSender, batchSize = 10) =>
    processNotificationBatch(db, { sender, appBaseUrl, batchSize, pauseMs: 0 }, now);

  it("el sorteo encola un DM de asignación por giver y se envía", async () => {
    const event = await drawnEvent(4);
    expect(await notificationStats(db, event.id)).toMatchObject({ pending: 4 });

    const { sender, sent } = fakeSender();
    expect(await process(sender)).toMatchObject({ sent: 4, failed: 0 });

    // A cada giver le llega el nombre de SU receptor.
    const rows = await db
      .select({ giverDiscord: user.discordId, assignmentId: assignments.id, receiverId: assignments.receiverId })
      .from(assignments)
      .innerJoin(participants, eq(participants.id, assignments.giverId))
      .innerJoin(user, eq(user.id, participants.userId));
    for (const row of rows) {
      const [receiver] = await db
        .select({ name: user.name })
        .from(participants)
        .innerJoin(user, eq(user.id, participants.userId))
        .where(eq(participants.id, row.receiverId));
      const message = sent.find((m) => m.discordId === row.giverDiscord)!;
      expect(message.content).toContain(`**${receiver.name}**`);
      expect(message.content).toContain(`${appBaseUrl}/assignment`);
    }

    // Se refleja en la asignación y no se reenvía.
    const statuses = await db.select({ s: assignments.dmStatus, at: assignments.dmSentAt }).from(assignments);
    expect(statuses.every((r) => r.s === "sent" && r.at)).toBe(true);
    expect(await process(sender)).toMatchObject({ sent: 0 });
  });

  it("respeta el tamaño del lote", async () => {
    await drawnEvent(5);
    const { sender } = fakeSender();
    expect(await process(sender, 2)).toMatchObject({ sent: 2 });
    expect(await process(sender, 10)).toMatchObject({ sent: 3 });
  });

  it("lotes en paralelo no envían dos veces el mismo DM", async () => {
    await drawnEvent(6);
    const { sender, sent } = fakeSender();
    await Promise.all([process(sender, 3), process(sender, 3), process(sender, 3)]);
    expect(sent).toHaveLength(6);
    expect(new Set(sent.map((m) => m.discordId)).size).toBe(6);
  });

  it("fallo transitorio: reintenta hasta 3 veces y luego requiere atención", async () => {
    const event = await drawnEvent(3);
    const { sender } = fakeSender(() => ({ ok: false, kind: "transient", error: "HTTP 502" }));

    expect(await process(sender)).toMatchObject({ retrying: 3 });
    expect(await process(sender)).toMatchObject({ retrying: 3 });
    expect(await process(sender)).toMatchObject({ failed: 3 });
    expect(await process(sender)).toMatchObject({ failed: 0, retrying: 0 });

    expect(await notificationStats(db, event.id)).toMatchObject({ failed: 3, pending: 0 });
    const [a] = await db.select().from(assignments);
    expect(a).toMatchObject({ dmStatus: "failed", dmAttempts: 3, dmLastError: "HTTP 502" });
  });

  it("fallo permanente (DMs cerrados): no reintenta", async () => {
    const event = await drawnEvent(3);
    const { sender } = fakeSender(() => ({ ok: false, kind: "permanent", error: "50007" }));
    expect(await process(sender)).toMatchObject({ failed: 3 });
    expect(await notificationStats(db, event.id)).toMatchObject({ failed: 3 });
  });

  it("rate limit: detiene el lote sin gastar intentos", async () => {
    await drawnEvent(4);
    const { sender, sent } = fakeSender((_, n) =>
      n === 2 ? { ok: false, kind: "rate_limited", error: "429", retryAfterMs: 1000 } : { ok: true },
    );
    expect(await process(sender)).toMatchObject({ sent: 1, rateLimited: true });
    expect(sent).toHaveLength(2);
    const pending = await db.select().from(notificationLog).where(eq(notificationLog.status, "pending"));
    expect(pending).toHaveLength(3);
    expect(pending.every((r) => r.attempts === 0)).toBe(true);
  });

  it("reenviar desde el panel reinicia los intentos", async () => {
    await drawnEvent(3);
    await process(fakeSender(() => ({ ok: false, kind: "permanent", error: "x" })).sender);
    const [failed] = await db.select().from(notificationLog).where(eq(notificationLog.status, "failed"));

    expect(await resendNotification(db, adminId, failed.id)).toBe(true);
    const [row] = await db.select().from(notificationLog).where(eq(notificationLog.id, failed.id));
    expect(row).toMatchObject({ status: "pending", attempts: 0, lastError: null });
    expect(await resendNotification(db, adminId, failed.id)).toBe(false); // ya está pendiente
  });

  it("repetir el sorteo descarta los DMs pendientes viejos y avisa del cambio", async () => {
    const event = await drawnEvent(3);
    await redraw(db, adminId, event.id, { confirm: true });

    const rows = await db.select().from(notificationLog).where(eq(notificationLog.kind, "assignment"));
    expect(rows.filter((r) => r.status === "skipped")).toHaveLength(3);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(3);

    const { sender, sent } = fakeSender();
    await process(sender);
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.content.includes("Se repitió el sorteo"))).toBe(true);
  });

  it("sorteo insuficiente: el aviso al admin se envía", async () => {
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -20) });
    await addParticipants(db, event.id, 2);
    await runDueActions(db, now);
    const { sender, sent } = fakeSender();
    expect(await process(sender)).toMatchObject({ sent: 1 });
    expect(sent[0].content).toContain("solo hay 2 participantes");
    expect(sent[0].content).toContain(`${appBaseUrl}/admin/events/${event.id}`);
  });

  describe("recordatorios", () => {
    /** Propuestas abiertas y cerrando mañana → toca el recordatorio de 1 día. */
    async function proposalsClosingTomorrow(n = 3) {
      const event = await drawnEvent(n);
      await db
        .update(eventPhases)
        .set({ endsAt: dayEndUtc(addDays(today, 1)), reminderDays: [1] })
        .where(and(eq(eventPhases.eventId, event.id), eq(eventPhases.key, "proposals")));
      return event;
    }

    it("recuerda solo a los givers sin propuestas, una vez", async () => {
      const event = await proposalsClosingTomorrow(3);
      const active = await db
        .select()
        .from(assignments)
        .where(and(eq(assignments.eventId, event.id), isNull(assignments.supersededBy)));
      await db.insert(proposals).values({
        assignmentId: active[0].id,
        title: "Cowboy Bebop",
        sourceUrl: "https://anilist.co/anime/1",
      });

      // Cierra mañana con recordatorio de 1 día → toca hoy.
      expect(await enqueueReminders(db, now)).toBe(2);
      expect(await enqueueReminders(db, now)).toBe(0); // dedupe

      const giverOf = await db
        .select({ userId: participants.userId })
        .from(participants)
        .where(eq(participants.id, active[0].giverId));
      const reminders = await db.select().from(notificationLog).where(eq(notificationLog.kind, "reminder"));
      expect(reminders.map((r) => r.userId)).not.toContain(giverOf[0].userId);

      const { sender, sent } = fakeSender();
      await process(sender, 20);
      expect(sent.filter((m) => m.content.includes("todavía no has propuesto"))).toHaveLength(2);
    });

    it("no recuerda nada fuera del día que toca", async () => {
      await proposalsClosingTomorrow(3);
      const farFuture = new Date(now.getTime() + 10 * 24 * 3600 * 1000);
      expect(await enqueueReminders(db, farFuture)).toBe(0);
    });
  });
});
