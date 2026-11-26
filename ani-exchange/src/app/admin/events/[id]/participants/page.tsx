import { CircleCheck, CircleX } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { PLATFORM_LABEL } from "@/lib/profiles";
import { episodeLimitLabel } from "@/lib/registration";
import { hasRole } from "@/lib/roles";
import { listParticipants } from "@/server/admin-participants";
import { getEventWithPhases } from "@/server/events";
import { ParticipantRowActions } from "./participant-row-actions";

const STATUS: Record<string, { label: string; variant: "secondary" | "destructive" | "outline" }> = {
  active: { label: "Activo", variant: "secondary" },
  no_show: { label: "No participó", variant: "destructive" },
  withdrawn: { label: "Retirado", variant: "outline" },
};

const DM_LABEL: Record<string, string> = {
  pending: "en cola",
  sent: "enviado",
  failed: "falló",
  skipped: "omitido",
};

async function ParticipantsContent({ params }: { params: PageProps<"/admin/events/[id]/participants">["params"] }) {
  const user = await requireRole("admin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = getDb();
  const data = await getEventWithPhases(db, id);
  if (!data) notFound();
  const { event } = data;
  const rows = await listParticipants(db, event.id);
  const isSuperadmin = hasRole(user.role, "superadmin");
  const drawn = Boolean(event.drawExecutedAt);
  const evidenceOver = data.phases.some((p) => p.key === "evidence" && p.status === "closed");
  const counts = { active: 0, no_show: 0, withdrawn: 0 };
  for (const r of rows) counts[r.status]++;

  return (
    <div className="space-y-6">
      <div>
        <Link href={isSuperadmin ? `/admin/events/${event.id}` : "/admin"} className="text-sm text-muted-foreground hover:underline">
          ← {isSuperadmin ? event.name : "Panel"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Participantes · {event.name}</h1>
        <p className="text-sm text-muted-foreground">
          {counts.active} activos · {counts.no_show} no participaron · {counts.withdrawn} retirados
          {drawn ? " · sorteo hecho" : " · sin sorteo"}
          {evidenceOver && ` · ${rows.filter((r) => r.finished === false).length} no terminaron`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">Nadie se ha inscrito todavía.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Límite</TableHead>
                <TableHead>Estado</TableHead>
                {drawn && <TableHead>DM de asignación</TableHead>}
                {evidenceOver && <TableHead title="Subió su review antes del cierre de Evidencia">¿Terminó?</TableHead>}
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      {p.image && (
                        // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
                        <img src={p.image} alt="" width={22} height={22} className="rounded-full" />
                      )}
                      {p.name}
                    </span>
                  </TableCell>
                  <TableCell>
                    <a href={p.profileUrl} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      {p.profileUsername}
                    </a>{" "}
                    <span className="text-xs text-muted-foreground">({PLATFORM_LABEL[p.platform]})</span>
                  </TableCell>
                  <TableCell className="text-sm">{episodeLimitLabel(p.maxEpisodes)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[p.status].variant}>{STATUS[p.status].label}</Badge>
                  </TableCell>
                  {drawn && (
                    <TableCell className="text-sm">
                      {p.assignmentDm ? (
                        <span title={p.assignmentDm.lastError ?? undefined}>
                          {DM_LABEL[p.assignmentDm.status] ?? p.assignmentDm.status}
                          {p.assignmentDm.status === "failed" && p.assignmentDm.lastError && (
                            <span className="block max-w-56 truncate text-xs text-muted-foreground">{p.assignmentDm.lastError}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  {evidenceOver && (
                    <TableCell className="text-sm">
                      {p.finished === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : p.finished ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <CircleCheck className="size-3.5" /> sí
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-destructive">
                          <CircleX className="size-3.5" /> no
                        </span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <ParticipantRowActions
                      participantId={p.id}
                      status={p.status}
                      drawn={drawn}
                      isSuperadmin={isSuperadmin}
                      failedDmId={p.assignmentDm?.status === "failed" ? p.assignmentDm.notificationId : null}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {drawn && isSuperadmin && (
        <p className="text-xs text-muted-foreground">
          &ldquo;Sacar del ciclo&rdquo;: quien le daba a esa persona pasa a darle a su receptor y recibe un DM para proponer de
          nuevo. Nadie da ni recibe más de una vez. Si la fase de propuestas ya cerró, extiéndela en la tabla de fases.
        </p>
      )}
    </div>
  );
}

export default function ParticipantsPage({ params }: PageProps<"/admin/events/[id]/participants">) {
  return (
    <div className="mx-auto max-w-5xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <ParticipantsContent params={params} />
      </Suspense>
    </div>
  );
}
