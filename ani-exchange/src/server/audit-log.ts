/** Consulta de audit_log para el panel (spec §14.8). */
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { auditLog, user } from "@/db/schema";

export const AUDIT_PAGE_SIZE = 50;

export type AuditFilters = { action?: string; entity?: string; actorId?: string; before?: Date };

export async function listAudit(db: Database, filters: AuditFilters = {}) {
  const conditions = [
    filters.action ? eq(auditLog.action, filters.action) : undefined,
    filters.entity ? eq(auditLog.entity, filters.entity) : undefined,
    filters.actorId ? eq(auditLog.actorId, filters.actorId) : undefined,
    filters.before ? lt(auditLog.createdAt, filters.before) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      createdAt: auditLog.createdAt,
      actorName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLog.createdAt))
    .limit(AUDIT_PAGE_SIZE + 1);

  const hasMore = rows.length > AUDIT_PAGE_SIZE;
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), hasMore };
}

/** Valores existentes para los filtros. */
export async function auditFilterOptions(db: Database) {
  const actions = await db
    .selectDistinct({ value: auditLog.action })
    .from(auditLog)
    .orderBy(auditLog.action);
  const entities = await db
    .selectDistinct({ value: auditLog.entity })
    .from(auditLog)
    .orderBy(auditLog.entity);
  const actors = await db
    .selectDistinct({ id: user.id, name: user.name })
    .from(auditLog)
    .innerJoin(user, eq(user.id, auditLog.actorId))
    .orderBy(user.name);
  return {
    actions: actions.map((a) => a.value),
    entities: entities.map((e) => e.value),
    actors,
    total: (await db.select({ n: sql<number>`count(*)::int` }).from(auditLog))[0].n,
  };
}
