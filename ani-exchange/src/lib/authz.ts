import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import type { UserRole } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { hasRole } from "@/lib/roles";

export type SessionUser = {
  id: string;
  name: string;
  image: string | null;
  discordId: string;
  role: UserRole;
};

/**
 * Usuario de la sesión actual o null. El rol se lee siempre de la base (no
 * de la sesión cacheada) para que un cambio de rol aplique de inmediato.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // Leer headers() primero: con cacheComponents esto marca el componente
  // como dinámico antes de tocar config/DB durante el prerender.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const [row] = await getDb()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      image: schema.user.image,
      discordId: schema.user.discordId,
      role: schema.user.role,
    })
    .from(schema.user)
    .where(eq(schema.user.id, session.user.id));
  return row ?? null;
}

/** Para páginas: redirige al home si no hay sesión. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/?login=required");
  return user;
}

/** Para páginas: redirige si el usuario no tiene al menos `role`. */
export async function requireRole(role: UserRole): Promise<SessionUser> {
  const user = await requireUser();
  if (!hasRole(user.role, role)) redirect("/?error=forbidden");
  return user;
}

export class AuthorizationError extends Error {}

/** Para server actions y route handlers: lanza en vez de redirigir. */
export async function assertRole(role: UserRole): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || !hasRole(user.role, role)) {
    throw new AuthorizationError("No autorizado");
  }
  return user;
}
