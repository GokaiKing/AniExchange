/**
 * Perfiles de MAL y AniList: interpretar lo que pega el usuario y verificar
 * que el perfil existe y que su lista es pública (spec §8).
 */
import { anilistQuery, ExternalServiceError, type FetchFn } from "./anilist";

export type Platform = "mal" | "anilist";

export const PLATFORM_LABEL: Record<Platform, string> = {
  mal: "MyAnimeList",
  anilist: "AniList",
};

export type ProfileRef =
  | { platform: Platform; kind: "name"; value: string }
  | { platform: "anilist"; kind: "id"; value: number };

export type ParseResult = { ok: true; ref: ProfileRef } | { ok: false; message: string };

const USERNAME = /^[A-Za-z0-9_-]{2,20}$/;

const HOSTS: Record<Platform, string[]> = {
  anilist: ["anilist.co", "www.anilist.co"],
  mal: ["myanimelist.net", "www.myanimelist.net"],
};

/**
 * Acepta un link de perfil o de lista, o el nombre de usuario a secas.
 *   AniList: anilist.co/user/{nombre|id}[/animelist]
 *   MAL:     myanimelist.net/profile/{nombre} o /animelist/{nombre}
 */
export function parseProfileInput(platform: Platform, raw: string): ParseResult {
  const input = raw.trim();
  if (!input) return { ok: false, message: "Pega el link a tu perfil" };

  const looksLikeUrl = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\//i.test(input);
  if (!looksLikeUrl) {
    return USERNAME.test(input)
      ? { ok: true, ref: { platform, kind: "name", value: input } }
      : { ok: false, message: "No parece un link ni un nombre de usuario válido" };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, message: "El link no es válido" };
  }

  const host = url.hostname.toLowerCase();
  if (!HOSTS[platform].includes(host)) {
    const other: Platform = platform === "mal" ? "anilist" : "mal";
    return {
      ok: false,
      message: HOSTS[other].includes(host)
        ? `Ese link es de ${PLATFORM_LABEL[other]}; cambia la plataforma o pega tu link de ${PLATFORM_LABEL[platform]}`
        : `El link debe ser de ${PLATFORM_LABEL[platform]}`,
    };
  }

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [section, name] = segments;

  if (platform === "anilist") {
    if (section !== "user" || !name) {
      return { ok: false, message: "El link de AniList debe ser del tipo anilist.co/user/tu_nombre" };
    }
    if (/^\d+$/.test(name)) {
      return { ok: true, ref: { platform: "anilist", kind: "id", value: Number(name) } };
    }
    return USERNAME.test(name)
      ? { ok: true, ref: { platform, kind: "name", value: name } }
      : { ok: false, message: "El nombre de usuario del link no es válido" };
  }

  if ((section !== "profile" && section !== "animelist") || !name) {
    return {
      ok: false,
      message: "El link de MAL debe ser del tipo myanimelist.net/profile/tu_nombre",
    };
  }
  return USERNAME.test(name)
    ? { ok: true, ref: { platform, kind: "name", value: name } }
    : { ok: false, message: "El nombre de usuario del link no es válido" };
}

// ---------------------------------------------------------------------------
// Verificación remota
// ---------------------------------------------------------------------------

export type VerifyResult =
  | { ok: true; username: string; profileUrl: string }
  | { ok: false; reason: "not_found" | "private" | "unavailable"; message: string };

const TIMEOUT_MS = 8000;
const USER_AGENT = "AniExchange/1.0 (intercambio de anime)";

const unavailable = (platform: Platform): VerifyResult => ({
  ok: false,
  reason: "unavailable",
  message: `No pudimos contactar a ${PLATFORM_LABEL[platform]}. Intenta de nuevo en unos minutos.`,
});

const ANILIST_USER_QUERY = /* GraphQL */ `
  query ($id: Int, $name: String) {
    User(id: $id, name: $name) { id name }
  }
`;

const ANILIST_LIST_QUERY = /* GraphQL */ `
  query ($userId: Int) {
    MediaListCollection(userId: $userId, type: ANIME, status: PLANNING, perChunk: 1, chunk: 1) {
      user { id }
    }
  }
`;

async function verifyAniList(ref: ProfileRef, fetchFn: FetchFn): Promise<VerifyResult> {
  try {
    const user = await anilistQuery<{ User: { id: number; name: string } | null }>(
      ANILIST_USER_QUERY,
      ref.kind === "id" ? { id: ref.value } : { name: ref.value },
      fetchFn,
    );
    if (!user.data?.User) {
      const notFound = user.httpStatus === 404 || user.errors.some((e) => e.status === 404);
      return notFound
        ? { ok: false, reason: "not_found", message: "No encontramos ese usuario en AniList" }
        : unavailable("anilist");
    }
    const { id, name } = user.data.User;

    const list = await anilistQuery<{ MediaListCollection: unknown }>(
      ANILIST_LIST_QUERY,
      { userId: id },
      fetchFn,
    );
    if (list.errors.some((e) => /private/i.test(e.message))) {
      return {
        ok: false,
        reason: "private",
        message: "Tu lista de AniList es privada. Hazla pública para que tu giver pueda verla.",
      };
    }
    if (!list.data?.MediaListCollection) return unavailable("anilist");

    return { ok: true, username: name, profileUrl: `https://anilist.co/user/${name}/` };
  } catch (error) {
    if (error instanceof ExternalServiceError) return unavailable("anilist");
    throw error;
  }
}

/** Extrae "Xinil" de "<title> Xinil&#039;s Profile - MyAnimeList.net </title>". */
export function malUsernameFromProfileHtml(html: string): string | null {
  const match = /<title>\s*([A-Za-z0-9_-]+)(?:&#0?39;|')s Profile/i.exec(html);
  return match ? match[1] : null;
}

async function verifyMal(ref: ProfileRef, fetchFn: FetchFn): Promise<VerifyResult> {
  const name = String(ref.value);
  const get = (url: string) =>
    fetchFn(url, {
      headers: { "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
    });

  try {
    const profile = await get(`https://myanimelist.net/profile/${encodeURIComponent(name)}`);
    if (profile.status === 404) {
      return { ok: false, reason: "not_found", message: "No encontramos ese usuario en MyAnimeList" };
    }
    if (!profile.ok) return unavailable("mal");
    const username = malUsernameFromProfileHtml(await profile.text()) ?? name;

    // load.json responde 400 si la lista es privada.
    const list = await get(
      `https://myanimelist.net/animelist/${encodeURIComponent(username)}/load.json?status=6&offset=0`,
    );
    if (list.status === 400 || list.status === 401 || list.status === 403) {
      return {
        ok: false,
        reason: "private",
        message: "Tu lista de MyAnimeList es privada. Hazla pública para que tu giver pueda verla.",
      };
    }
    if (!list.ok) return unavailable("mal");

    return { ok: true, username, profileUrl: `https://myanimelist.net/profile/${username}` };
  } catch {
    return unavailable("mal");
  }
}

export async function verifyProfile(ref: ProfileRef, fetchFn: FetchFn = fetch): Promise<VerifyResult> {
  return ref.platform === "anilist" ? verifyAniList(ref, fetchFn) : verifyMal(ref, fetchFn);
}
