"use client";

import { X } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TagOption } from "@/lib/anilist";

type Props = {
  label: string;
  hint: string;
  options: TagOption[];
  value: string[];
  onChange: (next: string[]) => void;
  max: number;
  /** Tags ya usados en la otra lista: no se ofrecen aquí. */
  exclude: string[];
  variant?: "default" | "destructive";
};

/** Selector de tags con autocompletado (datalist nativo) y chips. */
export function TagPicker({ label, hint, options, value, onChange, max, exclude, variant = "default" }: Props) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const available = options.filter((o) => !value.includes(o.name) && !exclude.includes(o.name));
  const full = value.length >= max;

  const add = (raw: string) => {
    const query = raw.trim().toLowerCase();
    if (!query) return;
    const match = options.find((o) => o.name.toLowerCase() === query);
    if (!match) return setError(`"${raw.trim()}" no está en la lista de AniList`);
    if (exclude.includes(match.name)) return setError(`"${match.name}" ya está en la otra lista`);
    if (value.includes(match.name)) return setText("");
    if (full) return setError(`Máximo ${max}`);
    onChange([...value, match.name]);
    setText("");
    setError(null);
  };

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}{" "}
        <span className="font-normal text-muted-foreground">
          ({value.length}/{max})
        </span>
      </label>
      <p className="text-xs text-muted-foreground">{hint}</p>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <Badge key={tag} variant={variant === "destructive" ? "destructive" : "secondary"} className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                aria-label={`Quitar ${tag}`}
                onClick={() => onChange(value.filter((t) => t !== tag))}
                className="rounded-sm opacity-70 hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {!full && (
        <div className="flex gap-2">
          <Input
            id={id}
            list={`${id}-options`}
            value={text}
            placeholder="Escribe para buscar…"
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              setError(null);
              // Al elegir una opción del datalist el valor coincide exacto: agregar directo.
              if (available.some((o) => o.name === next)) add(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(text);
              }
            }}
          />
          <Button type="button" variant="outline" onClick={() => add(text)}>
            Agregar
          </Button>
          <datalist id={`${id}-options`}>
            {available.map((o) => (
              <option key={o.name} value={o.name}>
                {o.category}
              </option>
            ))}
          </datalist>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
