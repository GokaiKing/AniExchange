import { getDb } from "@/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEnv } from "@/lib/env";
import { dmOptionsFromEnv } from "@/server/dm-config";
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
  const result = await runTick(getDb(), { dm: dmOptionsFromEnv() });
  return Response.json({ ok: true, ...result });
}

export const GET = handle;
export const POST = handle;
