"use client";

import { X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TagOption } from "@/lib/anilist";
import { ALIAS_HINTS, resolveTag, searchTags } from "@/lib/tag-aliases";

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

const MAX_SUGGESTIONS = 8;

/**
 * Selector de tags con buscador propio (no el <datalist> nativo: algunos
 * navegadores solo mostraban la categoría). Busca por fragmento y alias.
 */
export function TagPicker({ label, hint, options, value, onChange, max, exclude, variant = "default" }: Props) {
  const id = useId();
  const listId = `${id}-suggestions`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const full = value.length >= max;
  const categoryOf = useMemo(() => new Map(options.map((o) => [o.name, o.category])), [options]);
  const availableNames = useMemo(
    () => options.map((o) => o.name).filter((n) => !value.includes(n) && !exclude.includes(n)),
    [options, value, exclude],
  );
  const suggestions = useMemo(() => searchTags(text, availableNames, MAX_SUGGESTIONS), [text, availableNames]);
  const showList = open && suggestions.length > 0;

  const add = (raw: string) => {
    if (!raw.trim()) return;
    // Tolera mayúsculas, apóstrofos, espacios y alias (BL, Yaoi, GL, shonen…).
    const name = resolveTag(raw, options.map((o) => o.name));
    if (!name) return setError(`"${raw.trim()}" no está en la lista de AniList`);
    if (exclude.includes(name)) return setError(`"${name}" ya está en la otra lista`);
    if (value.includes(name)) return setText("");
    if (full) return setError(`Máximo ${max}`);
    onChange([...value, name]);
    setText("");
    setError(null);
    setHighlight(0);
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
          <div className="relative flex-1">
            <Input
              id={id}
              value={text}
              placeholder="Escribe para buscar… (ej. shonen, BL, isekai)"
              autoComplete="off"
              role="combobox"
              aria-expanded={showList}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={showList ? `${listId}-${highlight}` : undefined}
              onChange={(e) => {
                setText(e.target.value);
                setOpen(true);
                setHighlight(0);
                setError(null);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => setOpen(false)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && suggestions.length > 0) {
                  e.preventDefault();
                  setOpen(true);
                  setHighlight((h) => (h + 1) % suggestions.length);
                } else if (e.key === "ArrowUp" && suggestions.length > 0) {
                  e.preventDefault();
                  setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  add(showList ? suggestions[highlight] : text);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            {showList && (
              <ul
                id={listId}
                role="listbox"
                className="glass absolute top-full right-0 left-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
              >
                {suggestions.map((name, i) => (
                  <li
                    key={name}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === highlight}
                    // mousedown (no click) para no perder el foco del input antes de agregar
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(name);
                    }}
                    onMouseEnter={() => setHighlight(i)}
                    className={`cursor-pointer rounded-md px-2.5 py-1.5 ${i === highlight ? "bg-muted" : ""}`}
                  >
                    <span className="block text-sm font-medium">{name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {ALIAS_HINTS[name] ? `${ALIAS_HINTS[name]} · ` : ""}
                      {categoryOf.get(name)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => add(text)}>
            Agregar
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
