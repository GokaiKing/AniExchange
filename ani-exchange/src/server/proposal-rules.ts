/**
 * Reglas de propuestas (spec §11 + decisiones del admin, nov 2026). Puras.
 */
import type { ListStatus, Media } from "@/lib/anime";
import { yearTagMatches } from "@/lib/year-tags";

export const MAX_PROPOSALS = 3;
export const ALLOWED_FORMATS = ["TV", "ONA"] as const;
export const MIN_EPISODES = 10;
/** "Full length": minutos promedio por episodio. */
export const MIN_EPISODE_MINUTES = 20;
/** Un tag baneado bloquea desde esta relevancia (%); por debajo solo avisa. */
export const BANNED_TAG_MIN_RANK = 40;

const FORMAT_LABEL: Record<string, string> = {
  TV: "TV",
  TV_SHORT: "TV corta",
  MOVIE: "película",
  SPECIAL: "especial",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "video musical",
};

export type ReceiverRules = {
  /** null = sin límite superior. */
  maxEpisodes: number | null;
  bannedTags: string[];
  allowPtw: boolean;
};

export type RuleCheck = { errors: string[]; warnings: string[] };

/** ¿El anime cumple las reglas para este receptor? */
export function checkMedia(media: Media, rules: ReceiverRules): RuleCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (media.isAdult) errors.push("Es contenido para adultos");

  if (!media.format || !(ALLOWED_FORMATS as readonly string[]).includes(media.format)) {
    const label = media.format ? (FORMAT_LABEL[media.format] ?? media.format) : "desconocido";
    errors.push(`Formato no permitido (${label}); solo TV u ONA`);
  }

  if (media.status !== "FINISHED") errors.push("Todavía no termina de emitirse");

  if (media.episodes === null) {
    errors.push("No se sabe cuántos episodios tiene");
  } else {
    if (media.episodes < MIN_EPISODES) {
      errors.push(`Tiene ${media.episodes} episodios; el mínimo es ${MIN_EPISODES}`);
    }
    if (rules.maxEpisodes !== null && media.episodes > rules.maxEpisodes) {
      errors.push(`Tiene ${media.episodes} episodios; su límite es ${rules.maxEpisodes}`);
    }
  }

  if (media.duration === null || media.duration < MIN_EPISODE_MINUTES) {
    errors.push(
      media.duration === null
        ? "No se sabe cuánto duran los episodios"
        : `Episodios de ${media.duration} min; deben durar al menos ${MIN_EPISODE_MINUTES}`,
    );
  }

  for (const banned of rules.bannedTags) {
    const byYear = yearTagMatches(banned, media.year);
    if (byYear !== null) {
      if (media.year === null) warnings.push(`No se sabe el año de estreno (tiene baneado "${banned}")`);
      else if (byYear) errors.push(`Es de ${media.year} (tag baneado "${banned}")`);
      continue;
    }
    if (media.genres.includes(banned)) {
      errors.push(`Tiene el género baneado "${banned}"`);
      continue;
    }
    const tag = media.tags.find((t) => t.name === banned);
    if (tag && tag.rank >= BANNED_TAG_MIN_RANK) {
      errors.push(`Tiene el tag baneado "${banned}" (${tag.rank}%)`);
    } else if (tag) {
      warnings.push(`Tiene un poco del tag baneado "${banned}" (${tag.rank}%)`);
    }
  }

  return { errors, warnings };
}

/**
 * ¿El anime tiene alguno de los preferidos del receptor? Un género siempre
 * cuenta; un tag, desde la misma relevancia que usan los bans. Sin preferidos
 * marcados no hay nada que cumplir.
 */
export function missesPreferred(media: Media, allowedTags: readonly string[]): boolean {
  if (allowedTags.length === 0) return false;
  return !allowedTags.some(
    (wanted) =>
      yearTagMatches(wanted, media.year) === true ||
      media.genres.includes(wanted) ||
      media.tags.some((t) => t.name === wanted && t.rank >= BANNED_TAG_MIN_RANK),
  );
}

const LIST_WARNING: Record<ListStatus, string> = {
  completed: "Ya lo vio",
  repeating: "Ya lo vio (lo está repitiendo)",
  watching: "Lo está viendo",
  paused: "Lo tiene en pausa",
  dropped: "Lo dropeó",
  planning: "Está en su Plan to Watch",
};

/** Avisos (no bloquean) según la lista del receptor. */
export function listWarnings(status: ListStatus | null, rules: ReceiverRules): string[] {
  if (!status) return [];
  if (status === "planning") {
    return rules.allowPtw ? [] : ["Está en su Plan to Watch y pidió no recibir animes de ahí"];
  }
  return [LIST_WARNING[status]];
}
