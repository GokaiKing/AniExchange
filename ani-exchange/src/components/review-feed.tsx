import { ReviewImages } from "@/components/review-images";
import { ReviewMarkdown } from "@/components/review-markdown";
import { Card, CardContent } from "@/components/ui/card";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { formatAppDate } from "@/lib/dates";
import { canSeeFeed, type FeedItem, listFeed } from "@/server/evidence";
import { getCurrentEvent } from "@/server/participants";

function FeedCard({ item }: { item: FeedItem }) {
  return (
    <Card>
      <CardContent className="flex gap-4">
        {item.anime.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- portada externa de AniList
          <img src={item.anime.coverUrl} alt="" width={72} height={102} className="h-[102px] w-[72px] shrink-0 rounded object-cover" />
        )}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <a href={item.anime.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold underline-offset-4 hover:underline">
              {item.anime.title}
            </a>
            {item.rating !== null && <span className="text-sm font-medium text-festive-green">{item.rating}/10</span>}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {item.reviewer.image && (
              // eslint-disable-next-line @next/next/no-img-element -- avatar externo de Discord
              <img src={item.reviewer.image} alt="" width={18} height={18} className="rounded-full" />
            )}
            <span>
              Review de <span className="font-medium text-foreground">{item.reviewer.name}</span> · {formatAppDate(item.createdAt)}
              {item.trackerUrl && (
                <>
                  {" · "}
                  <a href={item.trackerUrl} target="_blank" rel="noreferrer" className="underline">
                    en su lista
                  </a>
                </>
              )}
            </span>
          </p>
          {item.containsSpoilers ? (
            <details className="rounded-md border border-festive-red/40 px-3 py-2">
              <summary className="cursor-pointer text-sm text-festive-red">⚠ Contiene spoilers: mostrar review</summary>
              <div className="space-y-2 pt-2">
                <ReviewMarkdown text={item.reviewText} />
                <ReviewImages images={item.images} />
              </div>
            </details>
          ) : (
            <>
              <ReviewMarkdown text={item.reviewText} />
              <ReviewImages images={item.images} />
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Feed del home (spec §12). Sin datos del giver antes del reveal. */
export async function ReviewFeed() {
  const user = await getSessionUser();
  const db = getDb();
  const current = await getCurrentEvent(db);
  if (!current) return null;

  if (!canSeeFeed(current.event, Boolean(user))) {
    return <p className="text-sm text-muted-foreground">Entra con Discord para ver las reviews del intercambio.</p>;
  }

  const items = await listFeed(db, current.event.id);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Reviews</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay reviews. Aparecerán aquí cuando la gente termine su anime.</p>
      ) : (
        items.map((item) => <FeedCard key={item.id} item={item} />)
      )}
    </section>
  );
}
