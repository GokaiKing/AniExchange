import type { Database, Transaction } from "@/db";
import { auditLog } from "@/db/schema";

export type DbExecutor = Database | Transaction;

export type AuditEntry = {
  /** null = acción del sistema (tick, seed). */
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Registra una acción en audit_log. Llamar dentro de la misma transacción que el cambio. */
export async function writeAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
