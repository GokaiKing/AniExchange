import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { auditFilterOptions, listAudit } from "@/server/audit-log";

const ACTION_LABEL: Record<string, string> = {
  "event.create": "Edición creada",
  "event.clone": "Edición clonada",
  "event.phases.update": "Fases editadas",
  "event.flags.update": "Pausa/archivo/visibilidad",
  "phase.close": "Fase cerrada",
  "phase.force_close": "Fase cerrada a mano",
  "draw.execute": "Sorteo",
  "draw.repeat": "Sorteo repetido",
  "draw.insufficient": "Sorteo sin participantes suficientes",
  "on_miss.proposals": "Política al cerrar propuestas",
  "on_miss.selection": "Política al cerrar elección",
  "participant.status": "Estado de participante",
  "participant.remove_from_cycle": "Sacado del ciclo",
  "pairings.view": "Consulta de emparejamientos",
  "dm.resend": "DM reenviado",
};

const select =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return <pre className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

async function AuditContent({ searchParams }: { searchParams: PageProps<"/admin/audit">["searchParams"] }) {
  await requireRole("superadmin");
  const params = await searchParams;
  const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
  const filters = {
    action: str(params.action),
    entity: str(params.entity),
    actorId: str(params.actor),
    before: str(params.before) ? new Date(str(params.before)!) : undefined,
  };
  if (filters.before && Number.isNaN(filters.before.getTime())) filters.before = undefined;

  const db = getDb();
  const [{ rows, hasMore }, options] = await Promise.all([listAudit(db, filters), auditFilterOptions(db)]);

  const query = (extra: Record<string, string>) => {
    const q = new URLSearchParams();
    if (filters.action) q.set("action", filters.action);
    if (filters.entity) q.set("entity", filters.entity);
    if (filters.actorId) q.set("actor", filters.actorId);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return `?${q.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Panel
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Auditoría</h1>
        <p className="text-sm text-muted-foreground">{options.total} registros en total. Fechas en hora de Hermosillo.</p>
      </div>

      <form className="flex flex-wrap items-end gap-2" method="get">
        <select name="action" defaultValue={filters.action ?? ""} className={select} aria-label="Acción">
          <option value="">Todas las acciones</option>
          {options.actions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABEL[a] ?? a}
            </option>
          ))}
        </select>
        <select name="entity" defaultValue={filters.entity ?? ""} className={select} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {options.entities.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <select name="actor" defaultValue={filters.actorId ?? ""} className={select} aria-label="Quién">
          <option value="">Cualquiera</option>
          {options.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonVariants({ size: "sm" })}>
          Filtrar
        </button>
        <Link href="/admin/audit" className={buttonVariants({ size: "sm", variant: "ghost" })}>
          Limpiar
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Sin registros con esos filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuándo</TableHead>
                <TableHead>Quién</TableHead>
                <TableHead>Acción</TableHead>
                <TableHead>Detalle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs">
                    {r.createdAt.toLocaleString("es-MX", { timeZone: "America/Hermosillo", dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell className="text-sm">{r.actorName ?? <span className="text-muted-foreground">sistema</span>}</TableCell>
                  <TableCell className="text-sm">
                    {ACTION_LABEL[r.action] ?? r.action}
                    <span className="block text-xs text-muted-foreground">{r.entity}</span>
                  </TableCell>
                  <TableCell className="max-w-md">
                    {(r.before !== null || r.after !== null) && (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">ver</summary>
                        <div className="mt-1 grid gap-1">
                          {r.before !== null && (
                            <>
                              <span className="text-xs">Antes</span>
                              <Json value={r.before} />
                            </>
                          )}
                          {r.after !== null && (
                            <>
                              <span className="text-xs">Después</span>
                              <Json value={r.after} />
                            </>
                          )}
                        </div>
                      </details>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMore && (
        <Link href={query({ before: rows[rows.length - 1].createdAt.toISOString() })} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Más antiguos →
        </Link>
      )}
    </div>
  );
}

export default function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <AuditContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
