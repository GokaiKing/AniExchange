/**
 * Envío de DMs con la REST API de Discord usando el token del bot (spec §10).
 * Sin bot persistente: abrir canal DM + publicar mensaje.
 */
import type { FetchFn } from "./anilist";

const API = "https://discord.com/api/v10";
const TIMEOUT_MS = 10_000;

export type SendResult =
  | { ok: true }
  /** No tiene caso reintentar (DMs cerrados, no comparte servidor, usuario inexistente). */
  | { ok: false; kind: "permanent"; error: string }
  /** Discord pidió esperar: detener el lote y seguir en el próximo tick. */
  | { ok: false; kind: "rate_limited"; error: string; retryAfterMs: number }
  /** Error de red o 5xx: reintentar. */
  | { ok: false; kind: "transient"; error: string };

export type DmSender = (discordUserId: string, content: string) => Promise<SendResult>;

/** Códigos JSON de Discord que indican que reintentar no sirve. */
const PERMANENT_CODES = new Set([
  10013, // Unknown User
  50007, // Cannot send messages to this user (DMs cerrados / sin servidor en común)
  50033, // Invalid Recipient(s)
  50278, // No mutual guilds (el bot no comparte servidor con el usuario)
]);

const MAX_CONTENT = 2000;

async function call(
  fetchFn: FetchFn,
  token: string,
  userAgent: string,
  path: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown>; headers: Headers } | { networkError: string }> {
  try {
    const response = await fetchFn(`${API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json",
        "user-agent": userAgent,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let data: Record<string, unknown> = {};
    try {
      data = await response.json();
    } catch {
      // cuerpo vacío o no JSON
    }
    return { status: response.status, data, headers: response.headers };
  } catch (error) {
    return { networkError: (error as Error).message };
  }
}

function classify(
  step: string,
  result: Awaited<ReturnType<typeof call>>,
): SendResult | null {
  if ("networkError" in result) {
    return { ok: false, kind: "transient", error: `${step}: ${result.networkError}` };
  }
  const { status, data } = result;
  if (status >= 200 && status < 300) return null;

  const message = `${step}: HTTP ${status}${data.code ? ` (${data.code})` : ""} ${String(data.message ?? "")}`.trim();
  if (status === 429) {
    const seconds = Number(data.retry_after ?? result.headers.get("retry-after") ?? 1);
    return { ok: false, kind: "rate_limited", error: message, retryAfterMs: Math.ceil(seconds * 1000) };
  }
  if (typeof data.code === "number" && PERMANENT_CODES.has(data.code)) {
    return { ok: false, kind: "permanent", error: message };
  }
  if (status === 401 || status === 403 || status === 404 || status === 400) {
    // 401: token inválido; 403/404/400 sin código conocido: no se arregla reintentando.
    return { ok: false, kind: status === 401 ? "transient" : "permanent", error: message };
  }
  return { ok: false, kind: "transient", error: message };
}

export function createDiscordSender(options: {
  botToken: string;
  appBaseUrl: string;
  fetchFn?: FetchFn;
}): DmSender {
  const fetchFn = options.fetchFn ?? fetch;
  // Discord exige este formato de User-Agent para bots.
  const userAgent = `DiscordBot (${options.appBaseUrl}, 1.0)`;

  return async (discordUserId, content) => {
    const channel = await call(fetchFn, options.botToken, userAgent, "/users/@me/channels", {
      recipient_id: discordUserId,
    });
    const channelError = classify("abrir DM", channel);
    if (channelError) return channelError;
    const channelId = "data" in channel ? String(channel.data.id ?? "") : "";
    if (!channelId) return { ok: false, kind: "transient", error: "abrir DM: respuesta sin id" };

    const message = await call(fetchFn, options.botToken, userAgent, `/channels/${channelId}/messages`, {
      content: content.slice(0, MAX_CONTENT),
      // Nunca hacer ping a nadie desde un DM automático.
      allowed_mentions: { parse: [] },
    });
    return classify("enviar mensaje", message) ?? { ok: true };
  };
}

/** Escapa caracteres de markdown de Discord en texto de usuarios (nombres, títulos). */
export function escapeMarkdown(text: string): string {
  return text.replace(/([\\*_~`|>#\-\[\]()])/g, "\\$1");
}

/** Timestamp que Discord muestra en la zona horaria de cada quien. */
export function discordTimestamp(date: Date, style: "f" | "F" | "R" = "f"): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}
