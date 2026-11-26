"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createEventAction, type CreateEventState } from "./actions";

type Props = {
  defaultYear: number;
  defaultStartDate: string;
  cloneOptions: { id: string; label: string }[];
};

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function NewEventDialog({ defaultYear, defaultStartDate, cloneOptions }: Props) {
  const canClone = cloneOptions.length > 0;
  const [mode, setMode] = useState<"fresh" | "clone">(canClone ? "clone" : "fresh");
  const [state, formAction, pending] = useActionState<CreateEventState, FormData>(
    createEventAction,
    {},
  );

  return (
    <Dialog>
      <DialogTrigger render={<Button />}>Nueva edición</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva edición</DialogTitle>
          <DialogDescription>
            Las fechas se interpretan en hora de Hermosillo. Podrás ajustarlas después.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="mode" value={mode} />

          <div className="grid gap-1.5">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" defaultValue={`Intercambio ${defaultYear}`} required />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="year">Año</Label>
            <Input id="year" name="year" type="number" defaultValue={defaultYear} required />
          </div>

          {canClone && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Fechas y reglas</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "clone"}
                  onChange={() => setMode("clone")}
                />
                Clonar de una edición anterior (fechas +N años)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  checked={mode === "fresh"}
                  onChange={() => setMode("fresh")}
                />
                Empezar con fechas por defecto
              </label>
            </fieldset>
          )}

          {mode === "clone" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="cloneFromEventId">Edición a clonar</Label>
              <select id="cloneFromEventId" name="cloneFromEventId" className={selectClass}>
                {cloneOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label htmlFor="startDate">Inicio de inscripción</Label>
              <Input
                id="startDate"
                name="startDate"
                type="date"
                defaultValue={defaultStartDate}
                required
              />
            </div>
          )}

          {state.error && <p className="text-sm text-destructive">{state.error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
