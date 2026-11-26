import { z } from "zod";

const commaList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );

const envSchema = z.object({
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET debe tener al menos 32 caracteres"),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_BOT_TOKEN: z.string().default(""),
  CRON_SECRET: z.string().default(""),
  SUPERADMIN_DISCORD_IDS: commaList,
  APP_TIMEZONE: z.literal("America/Hermosillo").default("America/Hermosillo"),
  APP_BASE_URL: z.url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/** Variables de entorno validadas. Se parsean una sola vez, al primer uso. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
