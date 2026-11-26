/** Cliente mínimo de AniList GraphQL (sin key). */

import { YEAR_TAG_CATEGORY, YEAR_TAGS } from "./year-tags";

export const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const TIMEOUT_MS = 8000;

export type FetchFn = typeof fetch;

export type AniListError = { message: string; status?: number };

export type AniListResponse<T> = {
  httpStatus: number;
  data: T | null;
  errors: AniListError[];
};

export class ExternalServiceError extends Error {}

export async function anilistQuery<T>(
  query: string,
  variables: Record<string, unknown> = {},
  fetchFn: FetchFn = fetch,
): Promise<AniListResponse<T>> {
  let response: Response;
  try {
    response = await fetchFn(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ExternalServiceError(`AniList no respondió: ${(error as Error).message}`);
  }

  let body: { data?: T | null; errors?: AniListError[] } = {};
  try {
    body = await response.json();
  } catch {
    // respuesta no JSON (p. ej. página de error de un proxy)
  }
  return { httpStatus: response.status, data: body.data ?? null, errors: body.errors ?? [] };
}

// ---------------------------------------------------------------------------
// Catálogo de géneros y tags
// ---------------------------------------------------------------------------

export type TagOption = { name: string; category: string };

/** Géneros que AniList marca como contenido adulto (GenreCollection no trae isAdult). */
const ADULT_GENRES = new Set(["Hentai"]);

const TAG_CATALOG_QUERY = /* GraphQL */ `
  query TagCatalog {
    GenreCollection
    MediaTagCollection { name category isAdult }
  }
`;

type TagCatalogData = {
  GenreCollection: string[];
  MediaTagCollection: { name: string; category: string | null; isAdult: boolean }[];
};

/** Géneros + tags de AniList sin contenido adulto, géneros primero. */
export async function fetchTagCatalog(fetchFn: FetchFn = fetch): Promise<TagOption[]> {
  const result = await anilistQuery<TagCatalogData>(TAG_CATALOG_QUERY, {}, fetchFn);
  if (!result.data) {
    const detail = result.errors[0]?.message ?? `HTTP ${result.httpStatus}`;
    throw new ExternalServiceError(`No se pudo cargar el catálogo de tags de AniList: ${detail}`);
  }

  const genres: TagOption[] = result.data.GenreCollection.filter((g) => !ADULT_GENRES.has(g)).map(
    (name) => ({ name, category: "Género" }),
  );
  const genreNames = new Set(genres.map((g) => g.name));
  const tags: TagOption[] = result.data.MediaTagCollection.filter(
    (tag) => !tag.isAdult && !genreNames.has(tag.name),
  )
    .map((tag) => ({ name: tag.name, category: tag.category ?? "Otros" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Tags de año (no existen en AniList; se validan contra el año de estreno).
  const years: TagOption[] = YEAR_TAGS.map((t) => ({ name: t.name, category: YEAR_TAG_CATEGORY }));
  return [...genres, ...years, ...tags];
}
