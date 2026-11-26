import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eventPhases, events } from "@/db/schema";
import { addDays, dayStartUtc, todayAppDate } from "@/lib/dates";
import type { ProfileRef, VerifyResult } from "@/lib/profiles";
import { createTestDb, createUser, hasTestDb, resetDb } from "../../tests/db";
import { createEvent } from "./events";
import {
  countActiveParticipants,
  getCurrentEvent,
  getRegistration,
  type RegistrationInput,
  registrationSchema,
  saveRegistration,
  withdrawRegistration,
} from "./participants";

const validTags = new Set(["Action", "Romance", "Isekai", "Horror", "Mecha"]);

const input: RegistrationInput = {
  platform: "anilist",
  profile: "https://anilist.co/user/gokufan",
  maxEpisodes: 24,
  bannedTags: ["Horror"],
  allowedTags: ["Action", "Isekai"],
  allowPtw: true,
};

const okVerify = vi.fn(
  async (ref: ProfileRef): Promise<VerifyResult> => ({
    ok: true,
    username: "GokuFan",
    profileUrl: `https://anilist.co/user/GokuFan/ (${ref.value})`,
  }),
);

describe("registrationSchema", () => {
  it("acepta una inscripción válida", () => {
    expect(registrationSchema.safeParse(input).success).toBe(true);
  });

  it("rechaza límites y combinaciones inválidas", () => {
    const bad = (patch: Partial<RegistrationInput>) =>
      registrationSchema.safeParse({ ...input, ...patch }).success;
    expect(bad({ maxEpisodes: 0 })).toBe(false);
    expect(bad({ maxEpisodes: 12.5 })).toBe(false);
    expect(bad({ bannedTags: ["a", "b", "c", "d", "e", "f"] })).toBe(false);
    expect(bad({ allowedTags: ["a", "b", "c", "d"] })).toBe(false);
    expect(bad({ bannedTags: ["Action"], allowedTags: ["Action"] })).toBe(false);
    expect(bad({ bannedTags: ["Horror", "Horror"] })).toBe(false);
  });
});

describe.skipIf(!hasTestDb)("inscripción (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  let userId: string;
  let eventId: string;
  const now = new Date();

  beforeEach(async () => {
    await resetDb(db);
    okVerify.mockClear();
    userId = (await createUser(db, { role: "user" })).id;
    // Inscripción abierta: empezó ayer (hora de Hermosillo).
    const event = await createEvent(db, null, {
      name: "Intercambio",
      year: 2026,
      startDate: addDays(todayAppDate(now), -1),
    });
    eventId = event.id;
  });

  afterAll(async () => {
    await close?.();
  });

  const save = (patch: Partial<RegistrationInput> = {}, verify = okVerify) =>
    saveRegistration(db, { userId, eventId, input: { ...input, ...patch }, now, validTags, verify });

  it("inscribe con el nombre canónico verificado", async () => {
    const result = await save();
    expect(result).toMatchObject({
      ok: true,
      participant: { profileUsername: "GokuFan", status: "active", maxEpisodes: 24 },
    });
    expect(okVerify).toHaveBeenCalledWith({ platform: "anilist", kind: "name", value: "gokufan" });
    expect(await countActiveParticipants(db, eventId)).toBe(1);
  });

  it("editar actualiza la misma fila (un participante por usuario)", async () => {
    await save();
    const second = await save({ maxEpisodes: 12, bannedTags: [] });
    expect(second).toMatchObject({ ok: true, participant: { maxEpisodes: 12, bannedTags: [] } });
    expect(await countActiveParticipants(db, eventId)).toBe(1);
  });

  it("retirarse y volver a inscribirse", async () => {
    await save();
    expect(await withdrawRegistration(db, { userId, eventId, now })).toEqual({ ok: true });
    expect((await getRegistration(db, eventId, userId))?.status).toBe("withdrawn");
    expect(await countActiveParticipants(db, eventId)).toBe(0);

    await save();
    expect((await getRegistration(db, eventId, userId))?.status).toBe("active");
  });

  it("no permite retirarse si no está inscrito", async () => {
    expect(await withdrawRegistration(db, { userId, eventId, now })).toMatchObject({ ok: false });
  });

  it("rechaza fuera de la ventana de inscripción, sin llamar a servicios externos", async () => {
    await db
      .update(eventPhases)
      .set({ startsAt: dayStartUtc(addDays(todayAppDate(now), 1)) })
      .where(eq(eventPhases.key, "registration"));
    expect(await save()).toMatchObject({ ok: false, error: expect.stringMatching(/no está abierta/) });
    expect(okVerify).not.toHaveBeenCalled();
  });

  it("rechaza si la edición está pausada", async () => {
    await db.update(events).set({ paused: true });
    expect(await save()).toMatchObject({ ok: false });
  });

  it("rechaza si la fase ya se cerró", async () => {
    await db.update(eventPhases).set({ status: "closed" }).where(eq(eventPhases.key, "registration"));
    expect(await save()).toMatchObject({ ok: false });
    expect(await withdrawRegistration(db, { userId, eventId, now })).toMatchObject({ ok: false });
  });

  it("rechaza tags fuera del catálogo", async () => {
    expect(await save({ bannedTags: ["Hentai"] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Hentai/),
    });
  });

  it("rechaza links inválidos sin llamar a servicios externos", async () => {
    expect(await save({ profile: "https://myanimelist.net/profile/x1" })).toMatchObject({
      ok: false,
      field: "profile",
    });
    expect(okVerify).not.toHaveBeenCalled();
  });

  it("propaga el mensaje si el perfil no se puede verificar", async () => {
    const privateList = vi.fn(
      async (): Promise<VerifyResult> => ({ ok: false, reason: "private", message: "Lista privada" }),
    );
    expect(await save({}, privateList)).toEqual({ ok: false, error: "Lista privada", field: "profile" });
    expect(await getRegistration(db, eventId, userId)).toBeNull();
  });

  it("getCurrentEvent ignora ediciones archivadas", async () => {
    expect((await getCurrentEvent(db))?.event.id).toBe(eventId);
    await db.update(events).set({ archived: true });
    expect(await getCurrentEvent(db)).toBeNull();
  });
});
