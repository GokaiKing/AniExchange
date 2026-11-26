/**
 * Límite básico de peticiones de escritura (spec §16), en Postgres para que
 * funcione igual con varias instancias serverless. Ventana fija por clave.
 */
import { lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateLimitRule = { limit: number; windowSeconds: number };

/** Reglas por acción (por usuario). */
export const RATE_LIMITS = {
  registration: { limit: 10, windowSeconds: 600 },
  proposal: { limit: 20, windowSeconds: 600 },
  selection: { limit: 30, windowSeconds: 600 },
  evidence: { limit: 20, windowSeconds: 600 },
  imageUpload: { limit: 40, windowSeconds: 600 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitedAction = keyof typeof RATE_LIMITS;

/** Cuenta un intento; devuelve false si se pasó del límite en la ventana actual. */
export async function hitRateLimit(
  db: Database,
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - rule.windowSeconds * 1000);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} < ${windowStart.toISOString()}::timestamptz then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${rateLimits.windowStart} < ${windowStart.toISOString()}::timestamptz then ${now.toISOString()}::timestamptz else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count });
  return row.count <= rule.limit;
}

export async function allowUserAction(db: Database, userId: string, action: RateLimitedAction): Promise<boolean> {
  return hitRateLimit(db, `${action}:${userId}`, RATE_LIMITS[action]);
}

export const RATE_LIMIT_MESSAGE = "Vas muy rápido. Espera unos minutos e inténtalo de nuevo.";

/** Borra ventanas viejas (cron diario). */
export async function pruneRateLimits(db: Database, now: Date = new Date()): Promise<void> {
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 3600 * 1000)));
}
