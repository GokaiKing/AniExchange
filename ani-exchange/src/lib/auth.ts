import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getEnv } from "@/lib/env";
import {
  discordIdFromPlaceholderEmail,
  discordPlaceholderEmail,
  resolveRole,
} from "@/lib/roles";

function createAuth() {
  const env = getEnv();
  const db = getDb();

  return betterAuth({
    secret: env.AUTH_SECRET,
    baseURL: env.APP_BASE_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    socialProviders: {
      discord: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        // Solo `identify`: no pedimos el email real.
        disableDefaultScope: true,
        scope: ["identify"],
        // Refresca nombre y avatar en cada login.
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({
          name: profile.global_name || profile.username,
          email: discordPlaceholderEmail(profile.id),
          emailVerified: false,
        }),
      },
    },
    account: {
      // Los tokens de Discord se guardan cifrados (AES con AUTH_SECRET). La app
      // no los usa: solo `identify` al iniciar sesión.
      encryptOAuthTokens: true,
    },
    verification: {
      // El "state" del flujo OAuth se guarda hasheado.
      storeIdentifier: "hashed",
    },
    user: {
      additionalFields: {
        // input: false → ni el cliente ni el perfil OAuth pueden escribirlos;
        // los fijamos en los hooks de abajo.
        discordId: { type: "string", required: false, input: false },
        role: { type: "string", required: false, defaultValue: "user", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const discordId = discordIdFromPlaceholderEmail(data.email);
            if (!discordId) return false; // solo se aceptan cuentas de Discord
            return {
              data: {
                ...data,
                discordId,
                role: resolveRole(discordId, "user", env.SUPERADMIN_DISCORD_IDS),
              },
            };
          },
        },
      },
      session: {
        create: {
          // Bootstrap de superadmin para usuarios ya existentes.
          after: async (session) => {
            const [row] = await db
              .select({ discordId: schema.user.discordId, role: schema.user.role })
              .from(schema.user)
              .where(eq(schema.user.id, session.userId));
            if (!row) return;
            const role = resolveRole(row.discordId, row.role, env.SUPERADMIN_DISCORD_IDS);
            if (role !== row.role) {
              await db.update(schema.user).set({ role }).where(eq(schema.user.id, session.userId));
            }
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
let instance: Auth | undefined;

export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}
