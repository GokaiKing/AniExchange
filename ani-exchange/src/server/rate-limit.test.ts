import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, resetDb } from "../../tests/db";
import { hitRateLimit } from "./rate-limit";

describe.skipIf(!hasTestDb)("rate limit (integración con Postgres)", () => {
  const { db, close } = hasTestDb ? createTestDb() : ({} as ReturnType<typeof createTestDb>);
  const rule = { limit: 3, windowSeconds: 60 };
  const t0 = new Date("2026-12-01T12:00:00Z");
  const at = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

  beforeEach(async () => {
    await resetDb(db);
  });
  afterAll(async () => {
    await close?.();
  });

  it("permite hasta el límite y bloquea después, dentro de la ventana", async () => {
    expect(await hitRateLimit(db, "k", rule, at(0))).toBe(true);
    expect(await hitRateLimit(db, "k", rule, at(10))).toBe(true);
    expect(await hitRateLimit(db, "k", rule, at(20))).toBe(true);
    expect(await hitRateLimit(db, "k", rule, at(30))).toBe(false);
  });

  it("se reinicia al pasar la ventana y es por clave", async () => {
    for (let i = 0; i < 4; i++) await hitRateLimit(db, "k", rule, at(i));
    expect(await hitRateLimit(db, "otra", rule, at(5))).toBe(true);
    expect(await hitRateLimit(db, "k", rule, at(61))).toBe(true);
  });

  it("es atómico con peticiones en paralelo", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => hitRateLimit(db, "p", rule, at(0))));
    expect(results.filter(Boolean)).toHaveLength(3);
  });
});
