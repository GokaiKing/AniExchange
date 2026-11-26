/** Validación de inscripción, compartida entre cliente y servidor (solo zod). */
import { z } from "zod";

export const MAX_BANNED_TAGS = 5;
export const MAX_ALLOWED_TAGS = 3;
export const EPISODE_PRESETS = [12, 24] as const;
export const MAX_EPISODES_LIMIT = 2000;

export const registrationSchema = z
  .object({
    platform: z.enum(["mal", "anilist"]),
    profile: z.string().trim().min(1, "Pega el link a tu perfil").max(300),
    maxEpisodes: z
      .number({ error: "Indica el límite de episodios" })
      .int("El límite de episodios debe ser un número entero")
      .min(1, "El límite de episodios debe ser al menos 1")
      .max(MAX_EPISODES_LIMIT, `El límite de episodios no puede pasar de ${MAX_EPISODES_LIMIT}`),
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
