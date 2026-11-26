"use client";

import { useState, useTransition } from "react";
import { chooseProposalAction, type ProposalActionState } from "./actions";

export type ChooserProposal = {
  id: string;
  title: string;
  episodes: number | null;
  sourceUrl: string;
  coverUrl: string | null;
  chosen: boolean;
  autoChosen: boolean;
};

/** El receptor elige una propuesta. No hay datos del giver aquí. */
export function ProposalChooser({ proposals, editable }: { proposals: ChooserProposal[]; editable: boolean }) {
  const [state, setState] = useState<ProposalActionState>({});
  const [pending, startTransition] = useTransition();

  const choose = (id: string) =>
    startTransition(async () => {
      setState(await chooseProposalAction(id));
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {proposals.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={!editable || pending}
            onClick={() => choose(p.id)}
            aria-pressed={p.chosen}
            className={`flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
              p.chosen ? "border-success ring-2 ring-success" : editable ? "hover:bg-muted/50" : ""
            } disabled:cursor-default`}
          >
            {p.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- portada externa de AniList
              <img src={p.coverUrl} alt="" className="aspect-[3/4] w-full object-cover" />
            )}
            <span className="space-y-0.5 p-2">
              <span className="block text-sm font-medium">{p.title}</span>
              <span className="block text-xs text-muted-foreground">{p.episodes ?? "?"} episodios</span>
              {p.chosen && (
                <span className="block text-xs font-medium text-success">
                  {p.autoChosen ? "Elegida automáticamente" : "Tu elección ✓"}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 text-xs">
        {proposals.map((p) => (
          <a key={p.id} href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-muted-foreground underline">
            Ver {p.title}
          </a>
        ))}
      </div>
      {editable && (
        <p className="text-xs text-muted-foreground">Puedes cambiar de opinión hasta que cierre la elección.</p>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
