/**
 * Búsqueda de tags tolerante: nombres comunes en la comunidad → nombre oficial
 * de AniList, y comparación sin mayúsculas, apóstrofos ni espacios.
 */

const BL = "Boys' Love";
const GL = "Yuri";

/** Alias normalizados → nombre exacto en AniList. */
const ALIASES: Record<string, string> = {
  // Hombres (BL)
  bl: BL,
  yaoi: BL,
  bara: BL,
  shounenai: BL,
  shonenai: BL,
  boyslove: BL,
  boylove: BL,
  gay: BL,
  bxb: BL,
  mxm: BL,
  boyxboy: BL,
  manxman: BL,
  chicoxchico: BL,
  hombrexhombre: BL,
  amorentrechicos: BL,
  amorentrehombres: BL,
  // Mujeres (GL)
  gl: GL,
  yuri: GL,
  shoujoai: GL,
  shojoai: GL,
  girlslove: GL,
  girllove: GL,
  lesbian: GL,
  lesbico: GL,
  lesbica: GL,
  lesbiana: GL,
  lesbianas: GL,
  gxg: GL,
  fxf: GL,
  girlxgirl: GL,
  womanxwoman: GL,
  chicaxchica: GL,
  mujerxmujer: GL,
  amorentrechicas: GL,
  amorentremujeres: GL,
  // Demografías (AniList las escribe con "u")
  shonen: "Shounen",
  shojo: "Shoujo",
  lgbt: "LGBTQ+ Themes",
  lgbtq: "LGBTQ+ Themes",
  scifi: "Sci-Fi",
  sliceoflife: "Slice of Life",
  sol: "Slice of Life",
};

/** Alias que se muestran como pista en el autocompletado. */
export const ALIAS_HINTS: Record<string, string> = {
  "Boys' Love": "BL · Yaoi · Shounen Ai · chico x chico",
  Yuri: "GL · Girls' Love · Shoujo Ai · chica x chica",
  "LGBTQ+ Themes": "LGBT",
};

/** "Boy's Love" → "boyslove". */
export function normalizeTag(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+]/g, "");
}

/** Encuentra el nombre oficial a partir de lo que escribió la persona. */
export function resolveTag(input: string, names: readonly string[]): string | null {
  const key = normalizeTag(input);
  if (!key) return null;
  const direct = names.find((name) => normalizeTag(name) === key);
  if (direct) return direct;
  const alias = ALIASES[key.replace(/\+/g, "")];
  return alias && names.includes(alias) ? alias : null;
}

/**
 * Sugerencias para lo que va escribiendo la persona: primero alias que
 * coinciden, luego nombres que empiezan con el texto y luego los que lo
 * contienen. Todo sin mayúsculas, apóstrofos, espacios ni acentos.
 */
export function searchTags(query: string, names: readonly string[], limit = 8): string[] {
  const q = normalizeTag(query);
  if (!q) return [];
  const available = new Set(names);
  const aliasQuery = q.replace(/\+/g, "");
  const exactAlias: string[] = [];
  const aliasPrefix: string[] = [];
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (!available.has(target)) continue;
    if (alias === aliasQuery) exactAlias.push(target);
    else if (alias.startsWith(aliasQuery)) aliasPrefix.push(target);
  }
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const key = normalizeTag(name);
    if (key.startsWith(q)) starts.push(name);
    else if (key.includes(q)) contains.push(name);
  }
  // Prioridad: alias exacto > empieza con > alias que empieza con > contiene.
  return [...new Set([...exactAlias, ...starts, ...aliasPrefix, ...contains])].slice(0, limit);
}
