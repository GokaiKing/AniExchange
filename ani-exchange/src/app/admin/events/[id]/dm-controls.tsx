"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type FlowState, processDmsAction, resendDmAction } from "../actions";

export type AttentionRow = {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  userName: string | null;
};

const KIND_LABEL: Record<string, string> = {
  assignment: "Asignación",
  reminder: "Recordatorio",
  admin_alert: "Aviso al admin",
};

export function DmControls({ rows, botConfigured }: { rows: AttentionRow[]; botConfigured: boolean }) {
  const [state, setState] = useState<FlowState>({});
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<FlowState>) =>
    startTransition(async () => {
      const result = await fn();
      setState(result);
      if (result.ok) toast.success(result.message ?? "Listo");
    });

  return (
    <div className="space-y-4">
      {!botConfigured && (
        <p className="rounded-md border border-festive-red/40 bg-accent px-3 py-2 text-sm text-accent-foreground">
          Falta <code>DISCORD_BOT_TOKEN</code>: los DMs se quedan en cola hasta configurarlo.
        </p>
      )}

      <Button variant="outline" disabled={pending || !botConfigured} onClick={() => run(processDmsAction)}>
        Enviar DMs pendientes ahora
      </Button>

      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Requieren atención</p>
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-medium">{row.userName ?? "¿?"}</span>{" "}
                  <span className="text-muted-foreground">
                    · {KIND_LABEL[row.kind] ?? row.kind} ·{" "}
                    {row.status === "failed" ? "falló" : "reintentando"} ({row.attempts} intentos)
                  </span>
                  {row.lastError && (
                    <p className="truncate text-xs text-muted-foreground" title={row.lastError}>
                      {row.lastError}
                    </p>
                  )}
                </div>
                {row.status === "failed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => resendDmAction(row.id))}
                  >
                    Reenviar
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Los errores de &ldquo;no mutual guilds&rdquo; o DMs cerrados se arreglan del lado del usuario
            (que esté en el servidor y permita DMs de miembros). El usuario igual ve su asignación en el sitio.
          </p>
        </div>
      )}

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
