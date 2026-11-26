import { createDiscordSender } from "@/lib/discord";
import { getEnv } from "@/lib/env";
import type { DmProcessingOptions } from "./notifications";

/** Configuración de envío desde el entorno, o null si no hay bot configurado. */
export function dmOptionsFromEnv(): DmProcessingOptions | null {
  const env = getEnv();
  if (!env.DISCORD_BOT_TOKEN) return null;
  return {
    sender: createDiscordSender({ botToken: env.DISCORD_BOT_TOKEN, appBaseUrl: env.APP_BASE_URL }),
    appBaseUrl: env.APP_BASE_URL,
    batchSize: env.DM_BATCH_SIZE,
  };
}
