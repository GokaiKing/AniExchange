import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { formatAppDateTime, toAppDate } from "@/lib/dates";
import { getEventWithPhases } from "@/server/events";
import { dmOptionsFromEnv } from "@/server/dm-config";
import { notificationStats, notificationsNeedingAttention } from "@/server/notifications";
import { drawSummary, ensureTicked } from "@/server/tick";
import { hasOnMiss, ON_MISS_LABEL, ON_MISS_OPTIONS, PHASE_LABEL } from "@/server/phases";
import { setEventFlagAction } from "../actions";
import { EventFlagBadges } from "../status-badges";
import { type EditorRow, PhaseEditor } from "./phase-editor";
import { DmControls } from "./dm-controls";
import { FlowControls } from "./flow-controls";
import { Timeline } from "./timeline";

function FlagButton({
  eventId,
  flag,
  value,
  children,
}: {
  eventId: string;
  flag: "paused" | "archived" | "feedPublic";
  value: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={setEventFlagAction}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="value" value={String(value)} />
      <Button type="submit" variant="outline" size="sm">
        {children}
      </Button>
    </form>
  );
}

async function EventDetail({ params }: { params: PageProps<"/admin/events/[id]">["params"] }) {
  await requireRole("superadmin");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  const now = new Date();
  await ensureTicked(db, now); // evaluación perezosa
  const data = await getEventWithPhases(db, id);
  if (!data) notFound();
  const { event, phases } = data;
  const [summary, dmStats, dmAttention] = await Promise.all([
    drawSummary(db, event.id),
    notificationStats(db, event.id),
    notificationsNeedingAttention(db, event.id),
  ]);

  // Fase en curso: la primera habilitada que no está cerrada.
  const current = phases.find((p) => p.enabled && p.status !== "closed");
  const alerts: string[] = [];
  if (event.paused) {
    alerts.push(
      event.drawExecutedAt || current?.key !== "registration" || current.endsAt > now
        ? "La edición está en pausa: el tick no la procesa."
        : "La edición se pausó porque no había suficientes participantes para el sorteo. Extiende la fecha de inscripción y luego reanúdala.",
    );
  }
  if (current && current.status === "open" && !current.autoAdvance && current.endsAt < now) {
    alerts.push(`${PHASE_LABEL[current.key]} ya venció y espera avance manual.`);
  }

  const rows: EditorRow[] = phases.map((phase) => ({
    key: phase.key,
    label: PHASE_LABEL[phase.key],
    status: phase.status,
    enabled: phase.enabled,
    start: toAppDate(phase.startsAt),
    end: toAppDate(phase.endsAt),
    autoAdvance: phase.autoAdvance,
    onMiss: phase.onMiss ?? "",
    reminders: phase.reminderDays.join(", "),
    endsAtLabel: formatAppDateTime(phase.endsAt),
    onMissOptions: hasOnMiss(phase.key)
      ? ON_MISS_OPTIONS[phase.key].map((value) => ({ value, label: ON_MISS_LABEL[value] }))
      : [],
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/events" className="text-sm text-muted-foreground hover:underline">
          ← Ediciones
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{event.name}</h1>
            <EventFlagBadges paused={event.paused} archived={event.archived} />
          </div>
          <div className="flex gap-2">
            <FlagButton eventId={event.id} flag="feedPublic" value={!event.feedPublic}>
              {event.feedPublic ? "Hacer feed privado" : "Hacer feed público"}
            </FlagButton>
            <FlagButton eventId={event.id} flag="paused" value={!event.paused}>
              {event.paused ? "Reanudar" : "Pausar"}
            </FlagButton>
            <FlagButton eventId={event.id} flag="archived" value={!event.archived}>
              {event.archived ? "Desarchivar" : "Archivar"}
            </FlagButton>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sorteo y flujo</CardTitle>
          <CardDescription>
            {event.drawExecutedAt ? (
              <>
                Sorteo ejecutado el {formatAppDateTime(event.drawExecutedAt)} ·{" "}
                {summary.active} asignaciones vigentes
                {summary.superseded > 0 && ` · ${summary.superseded} reemplazadas`}
              </>
            ) : (
              "El sorteo corre automáticamente al cerrar la inscripción."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {alerts.map((alert) => (
            <p
              key={alert}
              className="rounded-md border border-festive-red/40 bg-accent px-3 py-2 text-sm text-accent-foreground"
            >
              {alert}
            </p>
          ))}
          <FlowControls
            eventId={event.id}
            closable={
              current?.status === "open" && !event.paused && !event.archived
                ? { key: current.key, label: PHASE_LABEL[current.key] }
                : null
            }
            canRedraw={Boolean(event.drawExecutedAt) && !event.archived}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>DMs</CardTitle>
          <CardDescription>
            {dmStats.sent} enviados · {dmStats.pending} en cola · {dmStats.failed} fallidos
            {dmStats.skipped > 0 && ` · ${dmStats.skipped} omitidos`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DmControls rows={dmAttention} botConfigured={dmOptionsFromEnv() !== null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Línea de tiempo</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline phases={phases} now={new Date()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fases</CardTitle>
          <CardDescription>
            Cada fase empieza a las 00:00 y termina a las 23:59 del día elegido, hora de Hermosillo.
            Los recordatorios son días antes del cierre.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PhaseEditor eventId={event.id} initialRows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function EventDetailPage({ params }: PageProps<"/admin/events/[id]">) {
  return (
    <div className="mx-auto max-w-6xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <EventDetail params={params} />
      </Suspense>
    </div>
  );
}
