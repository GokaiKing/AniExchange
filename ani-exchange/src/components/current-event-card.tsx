import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { AppDateTime } from "@/components/app-date-time";
import {
  countActiveParticipants,
  getCurrentEvent,
  getRegistration,
  registrationPhaseOf,
} from "@/server/participants";
import { isPhaseActive } from "@/server/phases";

/** Tarjeta del home con la edición vigente y el estado de inscripción del usuario. */
export async function CurrentEventCard() {
  const user = await getSessionUser();
  const db = getDb();
  const current = await getCurrentEvent(db);

  if (!current) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sin edición activa</CardTitle>
          <CardDescription>Todavía no hay un intercambio en curso.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { event, phases } = current;
  const phase = registrationPhaseOf(phases);
  const now = new Date();
  const open = isPhaseActive(phase, event, now);
  const notYet = !event.paused && now < phase.startsAt;
  const [registration, count] = await Promise.all([
    user ? getRegistration(db, event.id, user.id) : null,
    countActiveParticipants(db, event.id),
  ]);
  const registered = registration?.status === "active";

  let description: React.ReactNode;
  if (event.paused) description = "La edición está en pausa.";
  else if (open)
    description = (
      <>
        Inscripción abierta hasta el <AppDateTime date={phase.endsAt} />.
      </>
    );
  else if (notYet)
    description = (
      <>
        La inscripción abre el <AppDateTime date={phase.startsAt} />.
      </>
    );
  else description = "La inscripción ya cerró.";

  return (
    <Card className="border-t-4 border-t-festive-red">
      <CardHeader>
        <CardTitle>{event.name}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          {count} {count === 1 ? "inscrito" : "inscritos"}
        </span>
        {registered && <span className="text-sm font-medium text-success">Estás inscrito ✓</span>}
        {open &&
          (user ? (
            <Link
              href={`/events/${event.id}/register`}
              className={buttonVariants({ variant: registered ? "outline" : "default", size: "sm" })}
            >
              {registered ? "Editar inscripción" : "Inscribirme"}
            </Link>
          ) : (
            <span className="text-sm">Entra con Discord para inscribirte.</span>
          ))}
      </CardContent>
    </Card>
  );
}
