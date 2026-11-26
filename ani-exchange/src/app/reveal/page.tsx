import { Lock, PartyPopper } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { AppDateTime } from "@/components/app-date-time";
import { RevealPairs } from "@/components/reveal-pairs";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { canSeeFeed } from "@/server/evidence";
import { getCurrentEvent } from "@/server/participants";
import { isRevealed, revealSummary } from "@/server/reveal";
import { ensureTicked } from "@/server/tick";

async function RevealContent() {
  const user = await getSessionUser();
  const db = getDb();
  await ensureTicked(db);
  const current = await getCurrentEvent(db);
  if (!current) return <p className="text-muted-foreground">No hay un intercambio en curso.</p>;

  if (!canSeeFeed(current.event, Boolean(user))) {
    return <p className="text-muted-foreground">Entra con Discord para ver el reveal.</p>;
  }

  if (!isRevealed(current.phases)) {
    const reveal = current.phases.find((p) => p.key === "reveal");
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Reveal · {current.event.name}</h1>
        <p className="text-muted-foreground">
          <Lock className="inline size-[1em] shrink-0 align-[-0.125em]" /> Todavía es secreto.
          {reveal?.enabled && (
            <>
              {" "}
              Se revela el <AppDateTime date={reveal.startsAt} />.
            </>
          )}
        </p>
      </div>
    );
  }

  const pairs = await revealSummary(db, current.event.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gold">
          <PartyPopper className="size-6" /> Reveal · {current.event.name}
        </h1>
        <p className="text-sm text-muted-foreground">Quién le regaló qué a quién, en el orden del ciclo.</p>
      </div>
      <RevealPairs pairs={pairs} />
      <Link href="/" className="text-sm text-muted-foreground hover:underline">
        ← Ver las reviews
      </Link>
    </div>
  );
}

export default function RevealPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <Suspense fallback={<p className="text-muted-foreground">Cargando…</p>}>
        <RevealContent />
      </Suspense>
    </div>
  );
}
