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
import { hasOnMiss, ON_MISS_LABEL, ON_MISS_OPTIONS, PHASE_LABEL } from "@/server/phases";
import { setEventFlagAction } from "../actions";
import { EventFlagBadges } from "../status-badges";
import { type EditorRow, PhaseEditor } from "./phase-editor";
import { Timeline } from "./timeline";

function FlagButton({
  eventId,
  flag,
  value,
  children,
}: {
  eventId: string;
  flag: "paused" | "archived";
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

  const data = await getEventWithPhases(getDb(), id);
  if (!data) notFound();
  const { event, phases } = data;

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
