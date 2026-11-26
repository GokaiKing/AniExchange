import Link from "next/link";
import { Suspense } from "react";
import { AppDateTime } from "@/components/app-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { PLATFORM_LABEL } from "@/lib/profiles";
import { getMyAssignmentView, type GiverView, type ReceiverView } from "@/server/assignment-views";
import { ensureTicked } from "@/server/tick";

function ptwUrl(receiver: GiverView["receiver"]): string {
  return receiver.platform === "anilist"
    ? `https://anilist.co/user/${receiver.profileUsername}/animelist/Planning`
    : `https://myanimelist.net/animelist/${receiver.profileUsername}?status=6`;
}

function TagList({ tags, variant }: { tags: string[]; variant: "secondary" | "destructive" }) {
  if (tags.length === 0) return <span className="text-muted-foreground">ninguno</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant={variant}>
          {tag}
        </Badge>
      ))}
    </span>
  );
}

function GiverCard({ view }: { view: GiverView }) {
  const { receiver } = view;
  return (
    <Card className="border-t-4 border-t-festive-green">
      <CardHeader>
        <CardDescription>Te toca darle un anime a</CardDescription>
        <CardTitle className="flex items-center gap-3 text-xl">
          {receiver.image && (
            // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
            <img src={receiver.image} alt="" width={40} height={40} className="rounded-full" />
          )}
          {receiver.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Perfil en {PLATFORM_LABEL[receiver.platform]}:{" "}
          <a href={receiver.profileUrl} target="_blank" rel="noreferrer" className="underline">
            {receiver.profileUsername}
          </a>
          {receiver.allowPtw && (
            <>
              {" · "}
              <a href={ptwUrl(receiver)} target="_blank" rel="noreferrer" className="underline">
                su Plan to Watch
              </a>
            </>
          )}
        </p>
        <p>
          Límite: <strong>{receiver.maxEpisodes} episodios</strong>
        </p>
        <p className="flex flex-wrap items-center gap-2">
          Preferidos: <TagList tags={receiver.allowedTags} variant="secondary" />
        </p>
        <p className="flex flex-wrap items-center gap-2">
          No permitidos: <TagList tags={receiver.bannedTags} variant="destructive" />
        </p>
        <p>
          {receiver.allowPtw
            ? "Acepta animes de su Plan to Watch."
            : "No quiere animes de su Plan to Watch."}
        </p>
        {view.proposalsDeadline && (
          <p>
            Propón hasta 3 opciones antes del <AppDateTime date={view.proposalsDeadline} />.
          </p>
        )}
        <p className="rounded-md border border-dashed px-3 py-2 text-muted-foreground">
          Muy pronto podrás proponer aquí mismo.
        </p>
        <p className="text-xs text-muted-foreground">🤫 Es secreto: no le digas a nadie a quién te tocó.</p>
      </CardContent>
    </Card>
  );
}

function ReceiverCard({ view }: { view: ReceiverView }) {
  return (
    <Card className="border-t-4 border-t-festive-red">
      <CardHeader>
        <CardTitle>Lo que vas a recibir</CardTitle>
        <CardDescription>
          Alguien del server te va a proponer hasta 3 animes. No sabrás quién hasta el reveal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          {view.proposalCount === 0
            ? "Todavía no hay propuestas para ti."
            : `Tienes ${view.proposalCount} ${view.proposalCount === 1 ? "propuesta" : "propuestas"}.`}
        </p>
        {view.selectionDeadline && (
          <p>
            Elegirás una antes del <AppDateTime date={view.selectionDeadline} />.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

async function AssignmentContent() {
  const user = await requireUser();
  const db = getDb();
  await ensureTicked(db);
  const view = await getMyAssignmentView(db, user.id);

  if (view.state === "no_event") {
    return <p className="text-muted-foreground">No hay un intercambio en curso.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi asignación</h1>
        <p className="text-sm text-muted-foreground">{view.event.name}</p>
      </div>

      {view.state === "not_registered" && (
        <Card>
          <CardHeader>
            <CardTitle>No estás inscrito</CardTitle>
            <CardDescription>Si la inscripción sigue abierta, todavía puedes entrar.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href={`/events/${view.event.id}/register`} className={buttonVariants({ size: "sm" })}>
              Ir a la inscripción
            </Link>
          </CardContent>
        </Card>
      )}

      {view.state === "not_drawn" && (
        <Card>
          <CardHeader>
            <CardTitle>Todavía no hay sorteo</CardTitle>
            <CardDescription>
              Cuando cierre la inscripción te llegará un DM con tu asignación, y también la verás aquí.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {view.state === "drawn" && (
        <>
          {view.asGiver ? (
            <GiverCard view={view.asGiver} />
          ) : (
            <p className="text-muted-foreground">No tienes asignación como giver en esta edición.</p>
          )}
          {view.asReceiver && <ReceiverCard view={view.asReceiver} />}
        </>
      )}
    </div>
  );
}

export default function AssignmentPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <AssignmentContent />
      </Suspense>
    </div>
  );
}
