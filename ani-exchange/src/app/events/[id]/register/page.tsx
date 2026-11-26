import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import type { TagOption } from "@/lib/anilist";
import { requireUser } from "@/lib/authz";
import { AppDateTime } from "@/components/app-date-time";
import { PLATFORM_LABEL } from "@/lib/profiles";
import { getEventWithPhases } from "@/server/events";
import { getRegistration, registrationPhaseOf } from "@/server/participants";
import { isPhaseActive } from "@/server/phases";
import { getTagCatalog } from "@/server/tag-catalog";
import { ensureTicked } from "@/server/tick";
import { RegistrationForm } from "./registration-form";

async function RegisterContent({ params }: { params: PageProps<"/events/[id]/register">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const db = getDb();
  await ensureTicked(db);
  const data = await getEventWithPhases(db, id);
  if (!data || data.event.archived) notFound();
  const { event, phases } = data;

  const phase = registrationPhaseOf(phases);
  const now = new Date();
  const open = isPhaseActive(phase, event, now);
  const registration = await getRegistration(db, event.id, user.id);
  const isActive = registration?.status === "active";

  const header = (
    <div>
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Inicio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Inscripción · {event.name}</h1>
      <p className="text-sm text-muted-foreground">
        {open ? "Cierra" : phase.endsAt < now ? "Cerró" : "Abre"} el{" "}
        <AppDateTime date={open || phase.endsAt < now ? phase.endsAt : phase.startsAt} />
      </p>
    </div>
  );

  if (!open) {
    return (
      <div className="space-y-6">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>La inscripción no está abierta</CardTitle>
            <CardDescription>
              {event.paused
                ? "La edición está en pausa."
                : phase.endsAt < now
                  ? "Ya no se pueden hacer cambios."
                  : "Vuelve cuando abra."}
            </CardDescription>
          </CardHeader>
          {isActive && registration && (
            <CardContent className="text-sm">
              Estás inscrito como{" "}
              <a href={registration.profileUrl} className="underline" target="_blank" rel="noreferrer">
                {registration.profileUsername}
              </a>{" "}
              ({PLATFORM_LABEL[registration.platform]}).
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  let tagOptions: TagOption[] | null = null;
  try {
    tagOptions = await getTagCatalog();
  } catch {
    tagOptions = null;
  }

  return (
    <div className="space-y-6">
      {header}
      <Card>
        <CardHeader>
          <CardTitle>{isActive ? "Tu inscripción" : "Inscríbete"}</CardTitle>
          {isActive && registration && (
            <CardDescription>
              Inscrito como{" "}
              <a href={registration.profileUrl} className="underline" target="_blank" rel="noreferrer">
                {registration.profileUsername}
              </a>
              . Puedes editar o retirarte hasta que cierre la inscripción.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {tagOptions ? (
            <RegistrationForm
              key={registration?.updatedAt.toISOString() ?? "new"}
              eventId={event.id}
              tagOptions={tagOptions}
              isActive={isActive}
              initial={
                registration
                  ? {
                      platform: registration.platform,
                      profile: registration.profileUrl,
                      maxEpisodes: registration.maxEpisodes,
                      bannedTags: registration.bannedTags,
                      allowedTags: registration.allowedTags,
                      allowPtw: registration.allowPtw,
                    }
                  : null
              }
            />
          ) : (
            <p className="text-sm text-destructive">
              No pudimos cargar la lista de tags de AniList. Recarga la página en un rato.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function RegisterPage({ params }: PageProps<"/events/[id]/register">) {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <RegisterContent params={params} />
      </Suspense>
    </div>
  );
}
