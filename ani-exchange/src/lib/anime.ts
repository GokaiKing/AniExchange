/**
 * Datos de anime (AniList GraphQL) y listas de usuarios (AniList / MAL).
 * Todo recibe `fetchFn` inyectable para pruebas.
 */
import { anilistQuery, ExternalServiceError, type FetchFn } from "./anilist";
import type { Platform } from "./profiles";

export type AnimeRef = { source: "anilist"; id: number } | { source: "mal"; id: number };

/** anilist.co/anime/{id}/… o myanimelist.net/anime/{id}/… */
export function parseAnimeLink(raw: string): AnimeRef | null {
  let url: URL;
  try {
    const input = raw.trim();
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const [section, id] = url.pathname.split("/").filter(Boolean);
  if (section !== "anime" || !id || !/^\d{1,9}$/.test(id)) return null;
  if (host === "anilist.co") return { source: "anilist", id: Number(id) };
  if (host === "myanimelist.net") return { source: "mal", id: Number(id) };
  return null;
}

export type Media = {
  id: number;
  idMal: number | null;
  title: string;
  format: string | null;
  status: string | null;
  episodes: number | null;
  /** Minutos promedio por episodio. */
  duration: number | null;
  isAdult: boolean;
  genres: string[];
  tags: { name: string; rank: number }[];
  coverUrl: string | null;
  siteUrl: string;
};

const MEDIA_FIELDS = /* GraphQL */ `
  id idMal format status episodes duration isAdult genres
  tags { name rank }
  title { userPreferred }
  coverImage { large }
  siteUrl
`;

type RawMedia = {
  id: number;
  idMal: number | null;
  format: string | null;
  status: string | null;
  episodes: number | null;
  duration: number | null;
  isAdult: boolean | null;
  genres: string[] | null;
  tags: { name: string; rank: number | null }[] | null;
  title: { userPreferred: string | null };
  coverImage: { large: string | null } | null;
  siteUrl: string;
};

function toMedia(raw: RawMedia): Media {
  return {
    id: raw.id,
    idMal: raw.idMal,
    title: raw.title.userPreferred ?? `Anime ${raw.id}`,
    format: raw.format,
    status: raw.status,
    episodes: raw.episodes,
    duration: raw.duration,
    isAdult: Boolean(raw.isAdult),
    genres: raw.genres ?? [],
    tags: (raw.tags ?? []).map((t) => ({ name: t.name, rank: t.rank ?? 0 })),
    coverUrl: raw.coverImage?.large ?? null,
    siteUrl: raw.siteUrl,
  };
}

/** null si AniList no lo tiene; lanza ExternalServiceError si AniList falla. */
export async function fetchMedia(ref: AnimeRef, fetchFn: FetchFn = fetch): Promise<Media | null> {
  const result = await anilistQuery<{ Media: RawMedia | null }>(
    `query ($id: Int, $idMal: Int) { Media(id: $id, idMal: $idMal, type: ANIME) { ${MEDIA_FIELDS} } }`,
    ref.source === "anilist" ? { id: ref.id } : { idMal: ref.id },
    fetchFn,
  );
  if (result.data?.Media) return toMedia(result.data.Media);
  const notFound = result.httpStatus === 404 || result.errors.some((e) => e.status === 404);
  if (notFound) return null;
  throw new ExternalServiceError(result.errors[0]?.message ?? `AniList HTTP ${result.httpStatus}`);
}

// ---------------------------------------------------------------------------
// Listas del receptor
// ---------------------------------------------------------------------------

export type ListStatus = "watching" | "completed" | "paused" | "dropped" | "planning" | "repeating";

const ANILIST_STATUS: Record<string, ListStatus> = {
  CURRENT: "watching",
  COMPLETED: "completed",
  PAUSED: "paused",
  DROPPED: "dropped",
  PLANNING: "planning",
  REPEATING: "repeating",
};

const MAL_STATUS: Record<number, ListStatus> = {
  1: "watching",
  2: "completed",
  3: "paused",
  4: "dropped",
  6: "planning",
};

/** Estado del anime en la lista del usuario, null si no lo tiene. */
export async function listStatusFor(
  platform: Platform,
  username: string,
  media: Media,
  fetchFn: FetchFn = fetch,
): Promise<ListStatus | null> {
  if (platform === "anilist") {
    const result = await anilistQuery<{ MediaList: { status: string } | null }>(
      `query ($u: String, $m: Int) { MediaList(userName: $u, mediaId: $m) { status } }`,
      { u: username, m: media.id },
      fetchFn,
    );
    if (result.data?.MediaList) return ANILIST_STATUS[result.data.MediaList.status] ?? null;
    if (result.errors.some((e) => e.status === 404)) return null;
    throw new ExternalServiceError(result.errors[0]?.message ?? `AniList HTTP ${result.httpStatus}`);
  }
  if (!media.idMal) return null;
  const entries = await fetchMalList(username, fetchFn);
  const entry = entries.find((e) => e.animeId === media.idMal);
  return entry ? (MAL_STATUS[entry.status] ?? null) : null;
}

type MalEntry = { animeId: number; status: number };

const MAL_PAGE = 300;
const MAL_MAX_PAGES = 15;

/** Lista completa (todas las categorías) de un usuario de MAL. */
export async function fetchMalList(username: string, fetchFn: FetchFn = fetch): Promise<MalEntry[]> {
  const entries: MalEntry[] = [];
  for (let page = 0; page < MAL_MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await fetchFn(
        `https://myanimelist.net/animelist/${encodeURIComponent(username)}/load.json?status=7&offset=${page * MAL_PAGE}`,
        { headers: { "user-agent": "AniExchange/1.0 (intercambio de anime)" }, signal: AbortSignal.timeout(10_000) },
      );
    } catch (error) {
      throw new ExternalServiceError(`MAL no respondió: ${(error as Error).message}`);
    }
    if (!response.ok) throw new ExternalServiceError(`MAL HTTP ${response.status}`);
    const batch = (await response.json()) as { anime_id: number; status: number }[];
    entries.push(...batch.map((e) => ({ animeId: e.anime_id, status: e.status })));
    if (batch.length < MAL_PAGE) break;
  }
  return entries;
}

/**
 * Referencias a los animes del Plan to Watch del usuario (para la política
 * on_miss random_from_ptw).
 */
export async function fetchPlanToWatch(
  platform: Platform,
  username: string,
  fetchFn: FetchFn = fetch,
): Promise<AnimeRef[]> {
  if (platform === "mal") {
    const entries = await fetchMalList(username, fetchFn);
    return entries.filter((e) => e.status === 6).map((e) => ({ source: "mal" as const, id: e.animeId }));
  }
  const result = await anilistQuery<{
    MediaListCollection: { lists: { entries: { mediaId: number }[] }[] } | null;
  }>(
    `query ($u: String) { MediaListCollection(userName: $u, type: ANIME, status: PLANNING) { lists { entries { mediaId } } } }`,
    { u: username },
    fetchFn,
  );
  if (!result.data?.MediaListCollection) {
    throw new ExternalServiceError(result.errors[0]?.message ?? `AniList HTTP ${result.httpStatus}`);
  }
  return result.data.MediaListCollection.lists.flatMap((list) =>
    list.entries.map((e) => ({ source: "anilist" as const, id: e.mediaId })),
  );
}
