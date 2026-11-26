/**
 * Tags de año de estreno. AniList no los tiene; se agregan al catálogo para
 * que funcionen como cualquier tag (baneado o preferido), como en ediciones
 * pasadas ("ban pre-2010").
 */

export const YEAR_TAG_CATEGORY = "Año de estreno";

type YearTag = { name: string; matches: (year: number) => boolean; aliases: string[] };

function before(year: number): YearTag {
  return {
    name: `Pre-${year}`,
    matches: (y) => y < year,
    aliases: [`antesde${year}`, `before${year}`, `pre${year}`],
  };
}

function since(year: number): YearTag {
  return {
    name: `Post-${year}`,
    matches: (y) => y >= year,
    aliases: [`${year}+`, `despuesde${year}`, `desde${year}`, `after${year}`, `post${year}`],
  };
}

export const YEAR_TAGS: YearTag[] = [
  before(2000),
  before(2010),
  before(2015),
  before(2020),
  since(2010),
  since(2015),
  since(2020),
];

const BY_NAME = new Map(YEAR_TAGS.map((t) => [t.name, t]));

export function isYearTag(name: string): boolean {
  return BY_NAME.has(name);
}

/** ¿El anime (por su año de estreno) cumple el tag de año? null si no es tag de año. */
export function yearTagMatches(name: string, year: number | null): boolean | null {
  const tag = BY_NAME.get(name);
  if (!tag) return null;
  return year !== null && tag.matches(year);
}

/** Alias normalizados → nombre del tag de año. */
export const YEAR_TAG_ALIASES: Record<string, string> = Object.fromEntries(
  YEAR_TAGS.flatMap((t) => t.aliases.map((alias) => [alias, t.name])),
);
