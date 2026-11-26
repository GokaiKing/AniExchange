/** Validación de inscripción, compartida entre cliente y servidor (solo zod). */
import { z } from "zod";

export const MAX_BANNED_TAGS = 3;
export const MAX_ALLOWED_TAGS = 5;
/**
 * Límite de episodios por cours (decisión del admin, nov 2026). Es un tope:
 * "2 cours" también acepta series de 1 cour. `null` = indefinido.
 */
export const EPISODE_LIMITS = [
  { max: 13, label: "1 cour", hint: "hasta 13 episodios" },
  { max: 26, label: "2 cours", hint: "hasta 26 episodios" },
  { max: null, label: "Indefinido", hint: "sin límite" },
] as const;

export type MaxEpisodes = (typeof EPISODE_LIMITS)[number]["max"];

/** "1 cour (hasta 13 episodios)"; tolera valores viejos fuera de los presets. */
export function episodeLimitLabel(max: number | null): string {
  const preset = EPISODE_LIMITS.find((limit) => limit.max === max);
  return preset ? `${preset.label} (${preset.hint})` : `hasta ${max} episodios`;
}

/** Lleva un valor guardado al preset más cercano (para precargar el formulario). */
export function nearestEpisodeLimit(max: number | null): MaxEpisodes {
  if (max === null) return null;
  if (max <= 13) return 13;
  if (max <= 26) return 26;
  return null;
}

export const registrationSchema = z
  .object({
    platform: z.enum(["mal", "anilist"]),
    profile: z.string().trim().min(1, "Pega el link a tu perfil").max(300),
    maxEpisodes: z.union([z.literal(13), z.literal(26), z.null()], {
      error: "Elige un límite de episodios",
    }),
    bannedTags: z.array(z.string().trim().min(1)).max(MAX_BANNED_TAGS, `Máximo ${MAX_BANNED_TAGS} tags baneados`),
    allowedTags: z.array(z.string().trim().min(1)).max(MAX_ALLOWED_TAGS, `Máximo ${MAX_ALLOWED_TAGS} tags permitidos`),
    allowPtw: z.boolean(),
  })
  .refine((v) => new Set(v.bannedTags).size === v.bannedTags.length, {
    message: "Hay tags baneados repetidos",
    path: ["bannedTags"],
  })
  .refine((v) => new Set(v.allowedTags).size === v.allowedTags.length, {
    message: "Hay tags permitidos repetidos",
    path: ["allowedTags"],
  })
  .refine((v) => !v.bannedTags.some((tag) => v.allowedTags.includes(tag)), {
    message: "Un tag no puede estar baneado y permitido a la vez",
    path: ["allowedTags"],
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;
