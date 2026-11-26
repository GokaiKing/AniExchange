/** Validación de evidencia (spec §12), compartida entre cliente y servidor. */
import { z } from "zod";

export const REVIEW_MIN = 20;
export const REVIEW_MAX = 5000;

const TRACKER_HOSTS = ["anilist.co", "myanimelist.net"];

function isTrackerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && TRACKER_HOSTS.includes(url.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

export const evidenceSchema = z.object({
  reviewText: z
    .string()
    .trim()
    .min(REVIEW_MIN, `La review debe tener al menos ${REVIEW_MIN} caracteres`)
    .max(REVIEW_MAX, `La review no puede pasar de ${REVIEW_MAX} caracteres`),
  rating: z
    .number()
    .min(0, "La calificación va de 0 a 10")
    .max(10, "La calificación va de 0 a 10")
    .refine((n) => Number.isInteger(n * 10), "Usa como máximo un decimal")
    .nullable(),
  trackerUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === "" || isTrackerUrl(v), "El link debe ser https de AniList o MyAnimeList")
    .transform((v) => (v === "" ? null : v)),
  containsSpoilers: z.boolean(),
});

export type EvidenceInput = z.input<typeof evidenceSchema>;
export type EvidenceData = z.output<typeof evidenceSchema>;
