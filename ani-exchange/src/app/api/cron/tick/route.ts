import { getDb } from "@/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEnv } from "@/lib/env";
import { isBlobConfigured, vercelBlobStore } from "@/server/blob-store";
import { dmOptionsFromEnv } from "@/server/dm-config";
import { cleanupOrphanImages } from "@/server/evidence";
import { pruneRateLimits } from "@/server/rate-limit";
import { runTick } from "@/server/tick";

/**
 * Tick programado (spec §15). Lo llama un cron externo con
 * `Authorization: Bearer $CRON_SECRET`. GET para Vercel Cron, POST para
 * cron-job.org u otros. Avanza fases, encola recordatorios y envía un lote de DMs.
 */
async function handle(request: Request): Promise<Response> {
  if (!isCronAuthorized(request.headers.get("authorization"), getEnv().CRON_SECRET)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const result = await runTick(db, { dm: dmOptionsFromEnv() });

  // Una vez al día (07:xx UTC = 00:xx Hermosillo): borrar imágenes huérfanas.
  let orphanImagesDeleted: number | null = null;
  const daily = new Date().getUTCHours() === 7;
  if (daily) await pruneRateLimits(db);
  if (isBlobConfigured() && daily) {
    try {
      orphanImagesDeleted = await cleanupOrphanImages(db, vercelBlobStore());
    } catch {
      orphanImagesDeleted = null;
    }
  }
  return Response.json({ ok: true, ...result, orphanImagesDeleted });
}

export const GET = handle;
export const POST = handle;
