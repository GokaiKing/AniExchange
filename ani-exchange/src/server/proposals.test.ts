import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assignments, eventPhases, notificationLog, participants, proposals } from "@/db/schema";
import type { AnimeRef, ListStatus, Media } from "@/lib/anime";
import { addDays, todayAppDate } from "@/lib/dates";
import { addParticipants, createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import type { AnimeServices } from "./anime-services";
import { createEvent } from "./events";
import {
  addProposal,
  chooseProposal,
  listGiverProposals,
  listReceiverProposals,
  removeProposal,
} from "./proposals";
import { runDueActions } from "./tick";

const anime = (id: number, patch: Partial<Media> = {}): Media => ({
  id,
  idMal: id + 1000,
  title: `Anime ${id}`,
  format: "TV",
  status: "FINISHED",
  episodes: 12,
  duration: 24,
  isAdult: false,
  genres: ["Action"],
  tags: [],
  coverUrl: null,
  siteUrl: `https://anilist.co/anime/${id}`,
  ...patch,
});

function fakeServices(options: {
  catalog?: Record<number, Media>;
  list?: Record<number, ListStatus>;
  ptw?: AnimeRef[];
  fail?: boolean;
} = {}): AnimeServices {
  const catalog = options.catalog ?? {};
  return {
    fetchMedia: async (ref) => {
      if (options.fail) throw new Error("caído");
      return catalog[ref.source === "anilist" ? ref.id : ref.id - 1000] ?? null;
    },
    listStatus: async (_p, _u, media) => options.list?.[media.id] ?? null,
    planToWatch: async () => options.ptw ?? [],
  };
}

describe.skipIf(!hasTestDb)("propuestas y elección (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const now = new Date();
  const today = todayAppDate(now);
  const hour = 3600 * 1000;

  let eventId: string;
  /** user ids por rol en la primera asignación */
  let giverUserId: string;
  let receiverUserId: string;
  let assignmentId: string;

  beforeEach(async () => {
    await resetDb(db);
    await createUser(db, { role: "superadmin" });
    // registration vencida → sorteo; proposals abierta (hoy-6 … hoy).
    const event = await createEvent(db, null, { name: "E", year: 2026, startDate: addDays(today, -20) });
    eventId = event.id;
    await addParticipants(db, eventId, 3);
    await runDueActions(db, now, fakeServices());

    const [a] = await db
      .select()
      .from(assignments)
      .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)))
      .limit(1);
    assignmentId = a.id;
    const userOf = async (pid: string) =>
      (await db.select().from(participants).where(eq(participants.id, pid)))[0].userId;
    giverUserId = await userOf(a.giverId);
    receiverUserId = await userOf(a.receiverId);
  });

  afterAll(async () => {
    await close?.();
  });

  const setPhase = (key: "proposals" | "selection", values: Partial<typeof eventPhases.$inferInsert>) =>
    db
      .update(eventPhases)
      .set(values)
      .where(and(eq(eventPhases.eventId, eventId), eq(eventPhases.key, key)));

  /** Cierra propuestas y abre elección ahora mismo. */
  async function moveToSelection() {
    await setPhase("proposals", { status: "closed", executedAt: now });
    await setPhase("selection", {
      status: "open",
      startsAt: new Date(now.getTime() - hour),
      endsAt: new Date(now.getTime() + 24 * hour),
    });
  }

  describe("proponer", () => {
    const services = fakeServices({
      catalog: { 1: anime(1), 2: anime(2), 3: anime(3), 4: anime(4), 5: anime(5, { format: "MOVIE" }) },
      list: { 2: "completed" },
    });
    const add = (link: string, userId = giverUserId, s = services) =>
      addProposal(db, { userId, link, now, services: s });

    it("agrega con los datos del anime y avisos de su lista", async () => {
      const first = await add("https://anilist.co/anime/1/Algo");
      expect(first).toMatchObject({ ok: true, proposal: { title: "Anime 1", episodes: 12, warnings: [] } });
      const second = await add("https://myanimelist.net/anime/1002");
      expect(second).toMatchObject({ ok: true, proposal: { anilistId: 2, warnings: ["Ya lo vio"] } });
    });

    it("marca cuando no tiene ninguno de los preferidos del receptor", async () => {
      const [a] = await db.select().from(assignments).where(eq(assignments.id, assignmentId));
      await db.update(participants).set({ allowedTags: ["Romance"] }).where(eq(participants.id, a.receiverId));
      const romance = fakeServices({ catalog: { 1: anime(1), 2: anime(2, { genres: ["Romance"] }) } });

      const plain = await add("anilist.co/anime/1", giverUserId, romance);
      const match = await add("anilist.co/anime/2", giverUserId, romance);
      expect(plain).toMatchObject({ ok: true, proposal: { missesPreferred: true } });
      expect(match).toMatchObject({ ok: true, proposal: { missesPreferred: false } });
    });

    it("máximo 3 y sin repetir", async () => {
      await add("anilist.co/anime/1");
      expect(await add("anilist.co/anime/1")).toMatchObject({ ok: false, error: expect.stringMatching(/Ya propusiste/) });
      await add("anilist.co/anime/2");
      await add("anilist.co/anime/3");
      expect(await add("anilist.co/anime/4")).toMatchObject({ ok: false, error: expect.stringMatching(/3 propuestas/) });
    });

    it("rechaza links inválidos, animes inexistentes o fuera de reglas", async () => {
      expect(await add("Cowboy Bebop")).toMatchObject({ ok: false });
      expect(await add("anilist.co/anime/999")).toMatchObject({ ok: false, error: expect.stringMatching(/no encontró/) });
      expect(await add("anilist.co/anime/5")).toMatchObject({ ok: false, error: expect.stringMatching(/película/) });
      expect(await add("anilist.co/anime/1", giverUserId, fakeServices({ fail: true }))).toMatchObject({
        ok: false,
        error: expect.stringMatching(/AniList/),
      });
    });

    it("solo el giver y solo con la fase abierta", async () => {
      // Quien no tiene esta asignación como giver propone en la suya propia, no en esta.
      await add("anilist.co/anime/1", receiverUserId);
      expect(await listGiverProposals(db, assignmentId)).toHaveLength(0);

      await setPhase("proposals", { status: "closed" });
      expect(await add("anilist.co/anime/1")).toMatchObject({ ok: false, error: expect.stringMatching(/no está abierta/) });
    });

    it("quitar solo las propias", async () => {
      const result = await add("anilist.co/anime/1");
      if (!result.ok) throw new Error(result.error);
      expect(await removeProposal(db, { userId: receiverUserId, proposalId: result.proposal.id, now })).toMatchObject({
        ok: false,
      });
      expect(await removeProposal(db, { userId: giverUserId, proposalId: result.proposal.id, now })).toEqual({ ok: true });
      expect(await listGiverProposals(db, assignmentId)).toHaveLength(0);
    });
  });

  describe("elegir", () => {
    let ids: string[];

    beforeEach(async () => {
      const services = fakeServices({ catalog: { 1: anime(1), 2: anime(2) } });
      ids = [];
      for (const id of [1, 2]) {
        const r = await addProposal(db, { userId: giverUserId, link: `anilist.co/anime/${id}`, now, services });
        if (!r.ok) throw new Error(r.error);
        ids.push(r.proposal.id);
      }
    });

    it("el receptor ve solo datos del anime", async () => {
      const list = await listReceiverProposals(db, assignmentId);
      expect(list).toHaveLength(2);
      expect(Object.keys(list[0]).sort()).toEqual(
        ["autoChosen", "chosen", "coverUrl", "episodes", "id", "sourceUrl", "title"].sort(),
      );
    });

    it("elige y puede cambiar de opinión mientras esté abierta", async () => {
      expect(await chooseProposal(db, { userId: receiverUserId, proposalId: ids[0], now })).toMatchObject({
        ok: false, // elección todavía no abre
      });
      await moveToSelection();
      expect(await chooseProposal(db, { userId: receiverUserId, proposalId: ids[0], now })).toEqual({ ok: true });
      expect(await chooseProposal(db, { userId: receiverUserId, proposalId: ids[1], now })).toEqual({ ok: true });
      const chosen = (await listReceiverProposals(db, assignmentId)).filter((p) => p.chosen);
      expect(chosen.map((p) => p.id)).toEqual([ids[1]]);
    });

    it("el giver no puede elegir por el receptor", async () => {
      await moveToSelection();
      expect(await chooseProposal(db, { userId: giverUserId, proposalId: ids[0], now })).toMatchObject({ ok: false });
    });
  });

  describe("on_miss al cerrar propuestas", () => {
    /** Vence propuestas ya; el tick la cierra y aplica la política. */
    async function closeProposals(policy: string, services: AnimeServices) {
      await setPhase("proposals", { onMiss: policy, endsAt: new Date(now.getTime() - 60_000) });
      return runDueActions(db, now, services);
    }
    const missingGivers = async () =>
      db.select().from(participants).where(and(eq(participants.eventId, eventId), eq(participants.status, "no_show")));

    it("random_from_ptw: agrega un anime válido de su PTW", async () => {
      const services = fakeServices({
        catalog: { 7: anime(7, { episodes: 50 }), 8: anime(8) },
        ptw: [{ source: "anilist", id: 7 }, { source: "anilist", id: 8 }],
      });
      const actions = await closeProposals("random_from_ptw", services);
      expect(actions).toContainEqual(
        expect.objectContaining({ type: "on_miss", phase: "proposals", affected: 3, needsAttention: 0 }),
      );
      const added = await db.select().from(proposals);
      expect(added).toHaveLength(3);
      // 7 tiene 50 episodios (> 26): nunca se elige.
      expect(added.every((p) => p.anilistId === 8 && p.autoAdded)).toBe(true);
      expect(await missingGivers()).toHaveLength(0);
    });

    it("random_from_ptw sin candidatos válidos: no participó + aviso al admin", async () => {
      await closeProposals("random_from_ptw", fakeServices({ ptw: [] }));
      expect(await missingGivers()).toHaveLength(3);
      const alerts = await db.select().from(notificationLog).where(eq(notificationLog.kind, "admin_alert"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0].payload).toMatchObject({ type: "on_miss", phase: "proposals", count: 3 });
    });

    it("mark_no_show solo afecta a quien no propuso", async () => {
      const services = fakeServices({ catalog: { 1: anime(1) } });
      await addProposal(db, { userId: giverUserId, link: "anilist.co/anime/1", now, services });
      await closeProposals("mark_no_show", services);
      expect(await missingGivers()).toHaveLength(2);
    });
  });

  describe("on_miss al cerrar elección", () => {
    async function proposeAllAndCloseSelection(policy: string) {
      const services = fakeServices({ catalog: { 1: anime(1), 2: anime(2) } });
      const rows = await db
        .select({ giver: participants.userId })
        .from(assignments)
        .innerJoin(participants, eq(participants.id, assignments.giverId))
        .where(eq(assignments.eventId, eventId));
      for (const { giver } of rows) {
        for (const id of [1, 2]) await addProposal(db, { userId: giver, link: `anilist.co/anime/${id}`, now, services });
      }
      await moveToSelection();
      await setPhase("selection", { onMiss: policy, endsAt: new Date(now.getTime() - 60_000) });
      return runDueActions(db, now, services);
    }

    it("first_option elige la primera para quien no eligió", async () => {
      await proposeAllAndCloseSelection("first_option");
      const chosen = await db.select().from(proposals).where(eq(proposals.chosen, true));
      expect(chosen).toHaveLength(3);
      expect(chosen.every((p) => p.autoChosen && p.anilistId === 1)).toBe(true);
    });

    it("random_option elige una para cada receptor que no eligió", async () => {
      const actions = await proposeAllAndCloseSelection("random_option");
      expect(actions).toContainEqual(expect.objectContaining({ type: "on_miss", phase: "selection", affected: 3 }));
      const chosen = await db.select().from(proposals).where(eq(proposals.chosen, true));
      expect(chosen).toHaveLength(3);
    });

    it("mark_no_show marca al receptor", async () => {
      await proposeAllAndCloseSelection("mark_no_show");
      const noShow = await db
        .select()
        .from(participants)
        .where(and(eq(participants.eventId, eventId), eq(participants.status, "no_show")));
      expect(noShow).toHaveLength(3);
    });
  });
});
