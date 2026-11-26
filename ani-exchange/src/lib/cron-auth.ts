import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Valida `Authorization: Bearer <CRON_SECRET>` en tiempo constante.
 * Se comparan los SHA-256 para que ambos lados midan lo mismo y la longitud
 * del secreto no se filtre. Sin secreto configurado, todo se rechaza.
 */
export function isCronAuthorized(authorization: string | null, secret: string): boolean {
  if (!secret || secret.length < 16) return false;
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!match) return false;
  const given = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}
