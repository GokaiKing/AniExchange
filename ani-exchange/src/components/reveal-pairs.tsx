import { Card, CardContent } from "@/components/ui/card";
import type { Person, RevealPair } from "@/server/reveal";

function Avatar({ person }: { person: Person }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      {person.image && (
        // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
        <img src={person.image} alt="" width={24} height={24} className="rounded-full" />
      )}
      {person.name}
    </span>
  );
}

/** Pares del reveal (giver → receptor, anime, calificación). */
export function RevealPairs({ pairs }: { pairs: RevealPair[] }) {
  return (
    <div className="space-y-3">
      {pairs.map((pair) => (
        <Card key={pair.assignmentId}>
          <CardContent className="flex flex-wrap items-center gap-4">
            {pair.anime?.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- portada externa de AniList
              <img src={pair.anime.coverUrl} alt="" width={48} height={68} className="h-[68px] w-12 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Avatar person={pair.giver} />
                <span className="text-muted-foreground">🎁 le regaló a</span>
                <Avatar person={pair.receiver} />
              </p>
              {pair.anime ? (
                <p className="flex flex-wrap items-center gap-2">
                  <a href={pair.anime.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline-offset-4 hover:underline">
                    {pair.anime.title}
                  </a>
                  {!pair.hasReview && (
                    <span className="rounded-full border border-destructive/50 bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
                      ❌ no lo terminó
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Sin anime elegido</p>
              )}
            </div>
            <span className="text-sm">
              {pair.rating !== null ? (
                <span className="font-medium text-festive-green">{pair.rating}/10</span>
              ) : (
                pair.hasReview && <span className="text-muted-foreground">sin calificación</span>
              )}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
