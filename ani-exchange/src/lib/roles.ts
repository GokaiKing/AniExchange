import type { UserRole } from "@/db/schema";

const RANK: Record<UserRole, number> = { user: 0, admin: 1, superadmin: 2 };

/** ¿`role` cumple con el mínimo `required`? (superadmin > admin > user) */
export function hasRole(role: UserRole, required: UserRole): boolean {
  return RANK[role] >= RANK[required];
}

/**
 * Rol que debe tener un usuario al iniciar sesión. Los IDs listados en
 * SUPERADMIN_DISCORD_IDS se promueven a superadmin; nunca se degrada a nadie
 * automáticamente (quitar un ID de la lista no le quita el rol).
 */
export function resolveRole(
  discordId: string,
  currentRole: UserRole,
  superadminIds: readonly string[],
): UserRole {
  return superadminIds.includes(discordId) ? "superadmin" : currentRole;
}

// Better Auth exige email; con scope `identify` Discord no lo da, así que
// usamos un placeholder derivado del ID (dominio .invalid, RFC 2606).
const PLACEHOLDER_DOMAIN = "discord.invalid";

export function discordPlaceholderEmail(discordId: string): string {
  return `${discordId}@${PLACEHOLDER_DOMAIN}`;
}

export function discordIdFromPlaceholderEmail(email: string): string | null {
  const match = /^(\d{5,25})@discord\.invalid$/.exec(email);
  return match ? match[1] : null;
}
