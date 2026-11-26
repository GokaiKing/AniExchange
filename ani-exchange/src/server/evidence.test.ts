import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, eventPhases, participants, proposals, user } from "@/db/schema";
import { addDays, todayAppDate } from "@/lib/dates";
import { evidenceSchema } from "@/lib/evidence";
import { addParticipants, createTestDb, hasTestDb, resetDb } from "../../tests/db";
import { createEvent } from "./events";
import type { BlobStore } from "./blob-store";
import { authorizeImageUpload, cleanupOrphanImages, listFeed, saveEvidence } from "./evidence";
import { runDueActions } from "./tick";

const valid = { reviewText: "Me encantó, la animación es buenísima.", rating: 8.5, trackerUrl: "", containsSpoilers: false };

describe("evidenceSchema", () => {
  const ok = (patch: object) => evidenceSchema.safeParse({ ...valid, ...patch }).success;

  it("acepta una evidencia válida y normaliza el link vacío", () => {
    expect(evidenceSchema.parse(valid).trackerUrl).toBeNull();
    expect(ok({ rating: null })).toBe(true);
    expect(ok({ trackerUrl: "https://anilist.co/user/x/animelist" })).toBe(true);
    expect(ok({ trackerUrl: "https://www.myanimelist.net/animelist/x" })).toBe(true);
  });

  it("rechaza reviews cortas, ratings fuera de rango y links ajenos", () => {
    expect(ok({ reviewText: "corta" })).toBe(false);
    expect(ok({ rating: 11 })).toBe(false);
    expect(ok({ rating: 7.25 })).toBe(false);
    expect(ok({ trackerUrl: "https://evil.example/x" })).toBe(false);
    expect(ok({ trackerUrl: "http://anilist.co/x" })).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("evidencia y feed (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const today = todayAppDate(now);
  const hour = 3600 * 1000;
  let eventId: string;
  let assignmentId: string;
  let receiverUserId: string;
  let giverUserId: string;

  beforeEach(async () => {
    await resetDb(db);
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -20) });
    eventId = event.id;
    await addParticipants(db, eventId, 3);
    await runDueActions(db, now);

    const [a] = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)))
      .limit(1);
    assignmentId = a.id;
    const userOf = async (pid: string) => (await db.select().from(participants).where(eq(participants.id, pid)))[0].userId;
    receiverUserId = await userOf(a.receiverId);
    giverUserId = await userOf(a.giverId);

    await db.insert(proposals).values({
      assignmentId,
      title: "Cowboy Bebop",
      episodes: 26,
      sourceUrl: "https://anilist.co/anime/1",
      chosen: true,
    });
  });

  afterAll(async () => {
    await close?.();
  });

  async function openEvidence() {
    await db.update(eventPhases).set({ status: "closed" }).where(eq(eventPhases.eventId, eventId));
    await db
      .update(eventPhases)
      .set({ status: "open", startsAt: new Date(now.getTime() - hour), endsAt: new Date(now.getTime() + 24 * hour) })
      .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, "evidence")));
  }

  const save = (userId: string, patch: object = {}) =>
    saveEvidence(db, { userId, input: evidenceSchema.parse({ ...valid, ...patch }), now });

  it("solo con la fase de evidencia abierta", async () => {
    expect(await save(receiverUserId)).toMatchObject({ ok: false, error: expect.stringMatching(/no está abierta/) });
  });

  it("el receptor sube y edita su review (una por asignación)", async () => {
    await openEvidence();
    expect(await save(receiverUserId)).toMatchObject({ ok: true, evidence: { rating: "8.5" } });
    expect(await save(receiverUserId, { rating: 9, containsSpoilers: true })).toMatchObject({
      ok: true,
      evidence: { rating: "9.0", containsSpoilers: true },
    });
    const feed = await listFeed(db, eventId);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ rating: 9, containsSpoilers: true, anime: { title: "Cowboy Bebop" } });
  });

  it("sin anime elegido no hay evidencia", async () => {
    await openEvidence();
    await db.update(proposals).set({ chosen: false });
    expect(await save(receiverUserId)).toMatchObject({ ok: false, error: expect.stringMatching(/elegido/) });
  });

  it("el feed muestra al receptor y NO al giver", async () => {
    await openEvidence();
    await save(receiverUserId);
    const [item] = await listFeed(db, eventId);

    const [receiver] = await db.select().from(user).where(eq(user.id, receiverUserId));
    const [giver] = await db.select().from(user).where(eq(user.id, giverUserId));
    expect(item.reviewer.name).toBe(receiver.name);

    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain(giver.id);
    expect(serialized).not.toContain(giver.discordId);
    expect(serialized).not.toContain(`"${giver.name}"`);
    expect(Object.keys(item).sort()).toEqual(
      ["anime", "containsSpoilers", "createdAt", "id", "images", "rating", "reviewText", "reviewer", "trackerUrl"].sort(),
    );
  });

  describe("imágenes", () => {
    const BLOB = "https://abc123.public.blob.vercel-storage.com";
    const img = (aid: string, n: number) => ({
      url: `${BLOB}/reviews/${aid}/img${n}.webp`,
      thumbUrl: `${BLOB}/reviews/${aid}/img${n}_thumb.webp`,
      width: 1600,
      height: 900,
    });

    function fakeBlob(): BlobStore & { files: Map<string, Date>; deleted: string[] } {
      const files = new Map<string, Date>();
      const deleted: string[] = [];
      return {
        files,
        deleted,
        head: async (url) => (files.has(url) ? { contentType: "image/webp", size: 200_000 } : null),
        del: async (urls) => {
          deleted.push(...urls);
          urls.forEach((u) => files.delete(u));
        },
        list: async () => [...files].map(([url, uploadedAt]) => ({ url, uploadedAt })),
      };
    }
    const upload = (blob: ReturnType<typeof fakeBlob>, i: ReturnType<typeof img>, at = now) => {
      blob.files.set(i.url, at);
      blob.files.set(i.thumbUrl, at);
    };
    const saveWith = (images: ReturnType<typeof img>[], blobStore: BlobStore | null) =>
      saveEvidence(db, { userId: receiverUserId, input: evidenceSchema.parse(valid), images, now, blobStore });

    it("guarda hasta 4 en orden y salen en el feed", async () => {
      await openEvidence();
      const blob = fakeBlob();
      const imgs = [1, 2, 3].map((n) => img(assignmentId, n));
      imgs.forEach((i) => upload(blob, i));
      expect(await saveWith(imgs, blob)).toMatchObject({ ok: true });
      const [item] = await listFeed(db, eventId);
      expect(item.images.map((i) => i.url)).toEqual(imgs.map((i) => i.url));
    });

    it("rechaza imágenes ajenas, de más, sin subir o sin Blob configurado", async () => {
      await openEvidence();
      const blob = fakeBlob();
      const foreign = img("00000000-0000-0000-0000-000000000000", 1);
      upload(blob, foreign);
      expect(await saveWith([foreign], blob)).toMatchObject({ ok: false, error: expect.stringMatching(/no es tuya/) });

      const five = [1, 2, 3, 4, 5].map((n) => img(assignmentId, n));
      five.forEach((i) => upload(blob, i));
      expect(await saveWith(five, blob)).toMatchObject({ ok: false, error: expect.stringMatching(/Máximo 4/) });

      expect(await saveWith([img(assignmentId, 9)], blob)).toMatchObject({
        ok: false,
        error: expect.stringMatching(/no terminó de subirse/),
      });
      expect(await saveWith([img(assignmentId, 1)], null)).toMatchObject({ ok: false });
    });

    it("al quitar una imagen la borra de Blob", async () => {
      await openEvidence();
      const blob = fakeBlob();
      const [a, b] = [img(assignmentId, 1), img(assignmentId, 2)];
      upload(blob, a);
      upload(blob, b);
      await saveWith([a, b], blob);
      await saveWith([b], blob);
      expect(blob.deleted.sort()).toEqual([a.thumbUrl, a.url].sort());
      const [item] = await listFeed(db, eventId);
      expect(item.images.map((i) => i.url)).toEqual([b.url]);
    });

    it("autoriza subidas solo a la carpeta de su asignación", async () => {
      await openEvidence();
      const ok = (pathname: string) => authorizeImageUpload(db, { userId: receiverUserId, pathname, now });
      expect(await ok(`reviews/${assignmentId}/abc.webp`)).toMatchObject({ ok: true, assignmentId });
      expect(await ok(`reviews/00000000-0000-0000-0000-000000000000/abc.webp`)).toMatchObject({ ok: false });
      expect(await ok(`reviews/${assignmentId}/../x.webp`)).toMatchObject({ ok: false });
      expect(await ok(`reviews/${assignmentId}/abc.svg`)).toMatchObject({ ok: false });
      expect(
        await authorizeImageUpload(db, { userId: giverUserId, pathname: `reviews/${assignmentId}/abc.webp`, now }),
      ).toMatchObject({ ok: false });
    });

    it("limpia solo las huérfanas viejas", async () => {
      await openEvidence();
      const blob = fakeBlob();
      const used = img(assignmentId, 1);
      const orphanOld = img(assignmentId, 2);
      const orphanNew = img(assignmentId, 3);
      upload(blob, used, new Date(now.getTime() - 48 * hour));
      upload(blob, orphanOld, new Date(now.getTime() - 48 * hour));
      upload(blob, orphanNew, now);
      await saveWith([used], blob);
      expect(await cleanupOrphanImages(db, blob, now)).toBe(2);
      expect([...blob.files.keys()].sort()).toEqual([used.thumbUrl, used.url, orphanNew.thumbUrl, orphanNew.url].sort());
    });
  });
});
