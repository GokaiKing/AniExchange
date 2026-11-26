"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addProposalAction, type ProposalActionState, removeProposalAction } from "./actions";

export type GiverProposal = {
  id: string;
  title: string;
  episodes: number | null;
  sourceUrl: string;
  coverUrl: string | null;
  warnings: string[];
  chosen: boolean;
  autoAdded: boolean;
  missesPreferred: boolean;
};

type Props = {
  proposals: GiverProposal[];
  /** Preferidos del receptor, para explicar la pastilla. */
  preferredTags: string[];
  max: number;
  /** ¿Se puede proponer ahora? */
  editable: boolean;
  /** Ya cerró la elección: se puede mostrar cuál eligió. */
  showChosen: boolean;
};

export function ProposalEditor({ proposals, preferredTags, max, editable, showChosen }: Props) {
  const [link, setLink] = useState("");
  const [state, setState] = useState<ProposalActionState>({});
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<ProposalActionState>, onOk?: (result: ProposalActionState) => void) =>
    startTransition(async () => {
      const result = await fn();
      setState(result);
      if (result.ok) onOk?.(result);
    });

  const notifyAdded = (result: ProposalActionState) => {
    setLink("");
    if (result.warnings && result.warnings.length > 0) {
      toast.warning("Propuesta agregada, pero ojo", { description: result.warnings.join(" · ") });
    } else {
      toast.success("Propuesta agregada");
    }
  };

  return (
    <div className="space-y-3">
      {proposals.length === 0 ? (
        <p className="text-muted-foreground">Todavía no propones nada.</p>
      ) : (
        <ul className="space-y-2">
          {proposals.map((p) => (
            <li key={p.id} className="glass flex gap-3 rounded-lg border p-2">
              {p.coverUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- portada externa de AniList
                <img src={p.coverUrl} alt="" width={48} height={68} className="h-[68px] w-12 rounded object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="font-medium underline-offset-4 hover:underline">
                    {p.title}
                  </a>
                  {p.missesPreferred && (
                    <span
                      className="rounded-full border border-warning/50 bg-warning/15 px-2 py-0.5 text-[0.7rem] font-medium text-warning"
                      title={`Prefiere: ${preferredTags.join(", ")}`}
                    >
                      Sin sus preferidos
                    </span>
                  )}
                </span>
                <p className="text-xs text-muted-foreground">
                  {p.episodes ?? "?"} episodios
                  {p.autoAdded && " · agregada automáticamente"}
                  {showChosen && p.chosen && <span className="ml-1 font-medium text-success">· la eligió ✓</span>}
                </p>
                {p.warnings.map((w) => (
                  <p key={w} className="text-xs text-festive-red">
                    ⚠ {w}
                  </p>
                ))}
              </div>
              {editable && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => removeProposalAction(p.id), () => toast.success("Propuesta quitada"))}
                >
                  Quitar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {editable && proposals.length < max && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => addProposalAction(link), notifyAdded);
          }}
        >
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://anilist.co/anime/… o https://myanimelist.net/anime/…"
            className="min-w-0 flex-1"
            aria-label="Link del anime"
          />
          <Button type="submit" disabled={pending || !link.trim()}>
            {pending ? "Revisando…" : "Proponer"}
          </Button>
        </form>
      )}

      {editable && (
        <p className="text-xs text-muted-foreground">
          {proposals.length}/{max} · Solo TV u ONA terminadas, de al menos 10 episodios de 20 min o más, dentro de su límite y sin
          sus géneros baneados.
        </p>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
