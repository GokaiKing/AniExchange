import { CircleCheck, PartyPopper } from "lucide-react";
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
import { RevealPairs } from "@/components/reveal-pairs";
import { canSeeFeed } from "@/server/evidence";
import { isRevealed, revealSummary } from "@/server/reveal";
import { ensureTicked } from "@/server/tick";

/** Tarjeta del home con la edición vigente y el estado de inscripción del usuario. */
export async function CurrentEventCard() {
  const user = await getSessionUser();
  const db = getDb();
  await ensureTicked(db); // evaluación perezosa (spec §15)
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

  // Tras el reveal, esta sección del home pasa a mostrar todos los pares.
  if (isRevealed(phases)) {
    if (!canSeeFeed(event, Boolean(user))) {
      return (
        <Card className="border-t-4 border-t-festive-red">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PartyPopper className="size-5" /> Reveal · {event.name}
            </CardTitle>
            <CardDescription>Entra con Discord para ver quién le regaló qué a quién.</CardDescription>
          </CardHeader>
        </Card>
      );
    }
    const pairs = await revealSummary(db, event.id);
    return (
      <section className="space-y-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-gold">
            <PartyPopper className="size-5" /> Reveal · {event.name}
          </h2>
          <p className="text-sm text-muted-foreground">Quién le regaló qué a quién, en el orden del ciclo.</p>
        </div>
        <RevealPairs pairs={pairs} />
      </section>
    );
  }
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
        {registered && (
          <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
            <CircleCheck className="size-4" /> Estás inscrito
          </span>
        )}
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
