import { Gift, Lock } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AppDateTime } from "@/components/app-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/db";
import { requireUser } from "@/lib/authz";
import { PLATFORM_LABEL } from "@/lib/profiles";
import { episodeLimitLabel } from "@/lib/registration";
import { getMyAssignmentView, type GiverView, type ReceiverView } from "@/server/assignment-views";
import { getCurrentEvent } from "@/server/participants";
import { isPhaseActive } from "@/server/phases";
import { MAX_PROPOSALS } from "@/server/proposal-rules";
import { listGiverProposals, listReceiverProposals } from "@/server/proposals";
import { chosenAnime, getEvidence } from "@/server/evidence";
import { ensureTicked } from "@/server/tick";
import { ReviewImages } from "@/components/review-images";
import { ReviewMarkdown } from "@/components/review-markdown";
import { isBlobConfigured } from "@/server/blob-store";
import { EvidenceForm } from "./evidence-form";
import { ProposalChooser } from "./proposal-chooser";
import { ProposalEditor } from "./proposal-editor";

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

function GiverCard({ view, children }: { view: GiverView; children: React.ReactNode }) {
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
          Límite: <strong>{episodeLimitLabel(receiver.maxEpisodes)}</strong>
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
        <div className="border-t pt-3">
          <p className="mb-2 font-medium">Tus propuestas</p>
          {children}
        </div>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" /> Es secreto: no le digas a nadie a quién te tocó.
        </p>
      </CardContent>
    </Card>
  );
}

function ReceiverCard({ view, children }: { view: ReceiverView; children?: React.ReactNode }) {
  return (
    <Card className="border-t-4 border-t-festive-red">
      <CardHeader>
        <CardTitle>{view.giver ? "Lo que recibiste" : "Lo que vas a recibir"}</CardTitle>
        <CardDescription>
          {view.giver ? (
            <>
              <Gift className="inline size-[1em] shrink-0 align-[-0.125em]" /> Te lo regaló <span className="font-medium text-gold">{view.giver.name}</span>.
            </>
          ) : (
            "Alguien del server te va a proponer hasta 3 animes. No sabrás quién hasta el reveal."
          )}
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
        {children}
      </CardContent>
    </Card>
  );
}

async function AssignmentContent() {
  const user = await requireUser();
  const db = getDb();
  await ensureTicked(db);
  const view = await getMyAssignmentView(db, user.id);
  const now = new Date();
  const current = await getCurrentEvent(db);
  const phase = (key: "proposals" | "selection" | "evidence") => current?.phases.find((p) => p.key === key);
  const active = (key: "proposals" | "selection" | "evidence") => {
    const p = phase(key);
    return Boolean(current && p && isPhaseActive(p, current.event, now));
  };
  const selection = phase("selection");
  const selectionStarted = Boolean(selection && (selection.status !== "pending" || selection.startsAt <= now));

  const giverProposals =
    view.state === "drawn" && view.asGiver ? await listGiverProposals(db, view.asGiver.assignmentId) : [];
  const receiverProposals =
    view.state === "drawn" && view.asReceiver && selectionStarted
      ? await listReceiverProposals(db, view.asReceiver.assignmentId)
      : [];
  // Ya no se puede cambiar la elección: mostrar el anime a ver y la evidencia.
  const selectionOver = Boolean(selection && selection.status === "closed");
  const myAnime =
    view.state === "drawn" && view.asReceiver && selectionOver ? await chosenAnime(db, view.asReceiver.assignmentId) : null;
  const myEvidence =
    view.state === "drawn" && view.asReceiver && myAnime ? await getEvidence(db, view.asReceiver.assignmentId) : null;
  const evidencePhase = phase("evidence");

  if (view.state === "no_event") {
    return <p className="text-muted-foreground">No hay un intercambio en curso.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Mi asignación</h1>
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
            <GiverCard view={view.asGiver}>
              <ProposalEditor
                proposals={giverProposals}
                preferredTags={view.asGiver.receiver.allowedTags}
                max={MAX_PROPOSALS}
                editable={active("proposals")}
                showChosen={selection?.status === "closed"}
              />
            </GiverCard>
          ) : (
            <p className="text-muted-foreground">No tienes asignación como giver en esta edición.</p>
          )}
          {view.asReceiver && (
            <ReceiverCard view={view.asReceiver}>
              {myAnime ? (
                <div className="space-y-4 border-t pt-3">
                  <div className="flex gap-3">
                    {myAnime.coverUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- portada externa de AniList
                      <img src={myAnime.coverUrl} alt="" width={64} height={90} className="h-[90px] w-16 rounded object-cover" />
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Te toca ver</p>
                      <a href={myAnime.sourceUrl} target="_blank" rel="noreferrer" className="text-lg font-semibold underline-offset-4 hover:underline">
                        {myAnime.title}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {myAnime.episodes ?? "?"} episodios{myAnime.autoChosen && " · elegida automáticamente"}
                      </p>
                    </div>
                  </div>

                  {active("evidence") ? (
                    <div>
                      <p className="mb-2 font-medium">{myEvidence ? "Tu review" : "Sube tu review"}</p>
                      <EvidenceForm
                        key={myEvidence?.updatedAt.toISOString() ?? "new"}
                        assignmentId={view.asReceiver.assignmentId}
                        imagesEnabled={isBlobConfigured()}
                        initial={
                          myEvidence && {
                            reviewText: myEvidence.reviewText,
                            rating: myEvidence.rating === null ? null : Number(myEvidence.rating),
                            trackerUrl: myEvidence.trackerUrl,
                            containsSpoilers: myEvidence.containsSpoilers,
                            images: myEvidence.images,
                          }
                        }
                      />
                      {evidencePhase && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Puedes editarla hasta el <AppDateTime date={evidencePhase.endsAt} />.
                        </p>
                      )}
                    </div>
                  ) : myEvidence ? (
                    <div>
                      <p className="mb-2 font-medium">
                        Tu review{myEvidence.rating !== null && ` · ${Number(myEvidence.rating)}/10`}
                      </p>
                      <div className="space-y-2">
                        <ReviewMarkdown text={myEvidence.reviewText} />
                        <ReviewImages images={myEvidence.images} />
                      </div>
                    </div>
                  ) : (
                    evidencePhase &&
                    evidencePhase.status === "pending" && (
                      <p className="text-muted-foreground">
                        Podrás subir tu review a partir del <AppDateTime date={evidencePhase.startsAt} />.
                      </p>
                    )
                  )}
                </div>
              ) : (
                receiverProposals.length > 0 && (
                  <ProposalChooser proposals={receiverProposals} editable={active("selection")} />
                )
              )}
            </ReceiverCard>
          )}
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
