"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PhaseStatus } from "@/db/schema";
import { type PhaseInput, updatePhasesAction, type UpdatePhasesState } from "../actions";
import { PhaseStatusBadge } from "../status-badges";

export type EditorRow = PhaseInput & {
  label: string;
  status: PhaseStatus;
  onMissOptions: { value: string; label: string }[];
  /** Texto ya formateado en el servidor, p. ej. "10 dic, 23:59 (horario del vendehumo del admin)". */
  endsAtLabel: string;
};

const selectClass =
  "h-8 w-full min-w-40 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function inputsOf(rows: PhaseInput[]): PhaseInput[] {
  return rows.map(({ key, enabled, start, end, autoAdvance, onMiss, reminders }) => ({
    key,
    enabled,
    start,
    end,
    autoAdvance,
    onMiss,
    reminders,
  }));
}

export function PhaseEditor({ eventId, initialRows }: { eventId: string; initialRows: EditorRow[] }) {
  // Solo los campos editables viven en estado; estado de fase y etiquetas se
  // leen siempre de lo que manda el servidor (se actualiza tras refresh()).
  const [inputs, setInputs] = useState(() => inputsOf(initialRows));
  const [confirmClosed, setConfirmClosed] = useState(false);
  const [state, setState] = useState<UpdatePhasesState>({});
  const [pending, startTransition] = useTransition();

  const rows = initialRows.map((meta, i) => ({ ...meta, ...inputs[i] }));

  const update = (key: string, patch: Partial<PhaseInput>) => {
    setInputs((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setState({});
  };

  const dirty = JSON.stringify(inputs) !== JSON.stringify(inputsOf(initialRows));
  const errorsFor = (key: string) => state.errors?.filter((error) => error.key === key) ?? [];
  const generalErrors = state.errors?.filter((error) => !error.key) ?? [];

  const save = () => {
    startTransition(async () => {
      const result = await updatePhasesAction(eventId, inputs, confirmClosed);
      setState(result);
      if (result.ok) {
        setConfirmClosed(false);
        toast.success("Fases guardadas");
      }
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      className="space-y-4"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fase</TableHead>
              <TableHead>Activa</TableHead>
              <TableHead>Inicio</TableHead>
              <TableHead>Fin</TableHead>
              <TableHead title="Avanza sola al llegar la fecha de fin">Auto</TableHead>
              <TableHead title="Días antes del cierre, separados por comas">Recordatorios</TableHead>
              <TableHead>Si no cumple</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rowErrors = errorsFor(row.key);
              return (
                <TableRow key={row.key} className={rowErrors.length ? "bg-destructive/5" : ""}>
                  <TableCell className="align-top">
                    <div className="font-medium">{row.label}</div>
                    <div className="mt-1">
                      <PhaseStatusBadge status={row.status} />
                    </div>
                    {rowErrors.map((error) => (
                      <p key={error.message} className="mt-1 max-w-56 text-xs whitespace-normal text-destructive">
                        {error.message}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="align-top">
                    <input
                      type="checkbox"
                      aria-label={`${row.label} activa`}
                      checked={row.enabled}
                      disabled={row.key === "registration"}
                      onChange={(e) => update(row.key, { enabled: e.target.checked })}
                      className="mt-2 size-4 accent-primary"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Input
                      type="date"
                      aria-label={`${row.label} inicio`}
                      value={row.start}
                      onChange={(e) => update(row.key, { start: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">00:00</p>
                  </TableCell>
                  <TableCell className="align-top">
                    <Input
                      type="date"
                      aria-label={`${row.label} fin`}
                      value={row.end}
                      onChange={(e) => update(row.key, { end: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">{row.endsAtLabel}</p>
                  </TableCell>
                  <TableCell className="align-top">
                    <input
                      type="checkbox"
                      aria-label={`${row.label} avance automático`}
                      checked={row.autoAdvance}
                      onChange={(e) => update(row.key, { autoAdvance: e.target.checked })}
                      className="mt-2 size-4 accent-primary"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Input
                      aria-label={`${row.label} recordatorios`}
                      value={row.reminders}
                      placeholder="p. ej. 3, 1"
                      onChange={(e) => update(row.key, { reminders: e.target.value })}
                      className="w-24"
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    {row.onMissOptions.length > 0 ? (
                      <select
                        aria-label={`${row.label} política si no cumple`}
                        value={row.onMiss}
                        onChange={(e) => update(row.key, { onMiss: e.target.value })}
                        className={selectClass}
                      >
                        {row.onMissOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {generalErrors.map((error) => (
        <p key={error.message} className="text-sm text-destructive">
          {error.message}
        </p>
      ))}

      {state.needsClosedConfirmation && (
        <Alert variant="destructive">
          <AlertTitle>Estás modificando una fase que ya terminó</AlertTitle>
          <AlertDescription>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmClosed}
                onChange={(e) => setConfirmClosed(e.target.checked)}
                className="size-4 accent-destructive"
              />
              Confirmo que quiero cambiar fases cerradas
            </label>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Guardando…" : "Guardar fases"}
        </Button>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setInputs(inputsOf(initialRows));
              setState({});
              setConfirmClosed(false);
            }}
          >
            Descartar cambios
          </Button>
        )}
      </div>
    </form>
  );
}
