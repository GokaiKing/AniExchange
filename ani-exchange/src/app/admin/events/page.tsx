import Link from "next/link";
import { Suspense } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/db";
import { requireRole } from "@/lib/authz";
import { todayAppDate } from "@/lib/dates";
import { listEvents } from "@/server/events";
import { NewEventDialog } from "./new-event-dialog";
import { EventFlagBadges } from "./status-badges";

async function EventsList() {
  await requireRole("superadmin");
  const events = await listEvents(getDb());
  const today = todayAppDate();
  const currentYear = Number(today.slice(0, 4));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Ediciones</h1>
        <NewEventDialog
          defaultYear={events.length > 0 ? Math.max(currentYear, events[0].year + 1) : currentYear}
          defaultStartDate={today}
          cloneOptions={events.map((event) => ({ id: event.id, label: event.name }))}
        />
      </div>

      {events.length === 0 ? (
        <p className="text-muted-foreground">
          Todavía no hay ediciones. Crea la primera con &ldquo;Nueva edición&rdquo;.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Año</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <Link
                    href={`/admin/events/${event.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {event.name}
                  </Link>
                </TableCell>
                <TableCell>{event.year}</TableCell>
                <TableCell className="space-x-1">
                  <EventFlagBadges paused={event.paused} archived={event.archived} />
                  {!event.paused && !event.archived && (
                    <span className="text-muted-foreground">Activa</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export default function EventsPage() {
  return (
    <div className="mx-auto max-w-4xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <EventsList />
      </Suspense>
    </div>
  );
}
