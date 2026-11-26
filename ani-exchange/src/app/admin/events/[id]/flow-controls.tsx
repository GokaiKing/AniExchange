"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { REDRAW_CONFIRMATION } from "@/lib/flow";
import {
  closePhaseNowAction,
  type FlowState,
  redrawAction,
  runTickAction,
} from "../actions";

type Props = {
  eventId: string;
  /** Fase en curso que se puede cerrar ahora (abierta), si hay. */
  closable: { key: string; label: string } | null;
  canRedraw: boolean;
};

export function FlowControls({ eventId, closable, canRedraw }: Props) {
  const [state, setState] = useState<FlowState>({});
  const [pending, startTransition] = useTransition();
  const [confirmClose, setConfirmClose] = useState(false);
  const [redrawUnlocked, setRedrawUnlocked] = useState(false);
  const [redrawText, setRedrawText] = useState("");

  const run = (fn: () => Promise<FlowState>) =>
    startTransition(async () => {
      const result = await fn();
      setState(result);
      if (result.ok) {
        toast.success(result.message ?? "Listo");
        setConfirmClose(false);
        setRedrawUnlocked(false);
        setRedrawText("");
      }
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={pending} onClick={() => run(runTickAction)}>
          Ejecutar tick ahora
        </Button>
        <span className="text-xs text-muted-foreground">
          Aplica lo que esté vencido en todas las ediciones (lo mismo que hace el cron).
        </span>
      </div>

      {closable && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">
            Cerrar {closable.label} ahora
            {closable.key === "registration" && " y ejecutar el sorteo"}
          </p>
          <p className="text-xs text-muted-foreground">
            Ejecuta la acción de cierre sin esperar la fecha de fin. No se puede deshacer.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmClose}
              onChange={(e) => setConfirmClose(e.target.checked)}
              className="size-4 accent-destructive"
            />
            Confirmo
          </label>
          <Button
            variant="destructive"
            disabled={pending || !confirmClose}
            onClick={() => run(() => closePhaseNowAction(eventId, closable.key, confirmClose))}
          >
            Cerrar {closable.label}
          </Button>
        </div>
      )}

      {canRedraw && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="text-sm font-medium">Repetir sorteo</p>
          <p className="text-xs text-muted-foreground">
            Bloqueado por defecto. Genera asignaciones nuevas y marca las anteriores como
            reemplazadas. Solo es posible mientras nadie haya propuesto.
          </p>
          {!redrawUnlocked ? (
            <Button variant="ghost" size="sm" onClick={() => setRedrawUnlocked(true)}>
              Desbloquear
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={redrawText}
                onChange={(e) => setRedrawText(e.target.value)}
                placeholder={`Escribe ${REDRAW_CONFIRMATION}`}
                className="w-44"
                aria-label="Confirmación para repetir el sorteo"
              />
              <Button
                variant="destructive"
                disabled={pending || redrawText.trim() !== REDRAW_CONFIRMATION}
                onClick={() => run(() => redrawAction(eventId, redrawText))}
              >
                Repetir sorteo
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setRedrawUnlocked(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
