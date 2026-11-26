"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TagOption } from "@/lib/anilist";
import { PLATFORM_LABEL, type Platform } from "@/lib/profiles";
import {
  EPISODE_PRESETS,
  MAX_ALLOWED_TAGS,
  MAX_BANNED_TAGS,
  type RegistrationInput,
} from "@/lib/registration";
import {
  type RegistrationState,
  saveRegistrationAction,
  withdrawRegistrationAction,
} from "./actions";
import { TagPicker } from "./tag-picker";

type Props = {
  eventId: string;
  tagOptions: TagOption[];
  /** Inscripción existente (activa o retirada), para precargar el formulario. */
  initial: RegistrationInput | null;
  isActive: boolean;
};

const PLACEHOLDER: Record<Platform, string> = {
  anilist: "https://anilist.co/user/tu_nombre",
  mal: "https://myanimelist.net/profile/tu_nombre",
};

export function RegistrationForm({ eventId, tagOptions, initial, isActive }: Props) {
  const [platform, setPlatform] = useState<Platform>(initial?.platform ?? "anilist");
  const [profile, setProfile] = useState(initial?.profile ?? "");
  const initialPreset =
    initial && !(EPISODE_PRESETS as readonly number[]).includes(initial.maxEpisodes)
      ? "other"
      : String(initial?.maxEpisodes ?? 12);
  const [episodePreset, setEpisodePreset] = useState(initialPreset);
  const [otherEpisodes, setOtherEpisodes] = useState(
    initialPreset === "other" ? String(initial?.maxEpisodes) : "",
  );
  const [bannedTags, setBannedTags] = useState(initial?.bannedTags ?? []);
  const [allowedTags, setAllowedTags] = useState(initial?.allowedTags ?? []);
  const [allowPtw, setAllowPtw] = useState(initial?.allowPtw ?? true);

  const [state, setState] = useState<RegistrationState>({});
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [pending, startTransition] = useTransition();

  const maxEpisodes = episodePreset === "other" ? Number(otherEpisodes) : Number(episodePreset);

  const submit = () =>
    startTransition(async () => {
      setState(
        await saveRegistrationAction(eventId, {
          platform,
          profile,
          maxEpisodes,
          bannedTags,
          allowedTags,
          allowPtw,
        }),
      );
    });

  const withdraw = () =>
    startTransition(async () => {
      setState(await withdrawRegistrationAction(eventId));
      setConfirmWithdraw(false);
    });

  const fieldError = (field: keyof RegistrationInput) =>
    state.field === field && state.error ? (
      <p className="text-xs text-destructive">{state.error}</p>
    ) : null;

  return (
    <form
      className="grid gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Plataforma</legend>
        <div className="flex gap-4">
          {(["anilist", "mal"] as const).map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="platform"
                checked={platform === value}
                onChange={() => setPlatform(value)}
                className="accent-primary"
              />
              {PLATFORM_LABEL[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="profile">Link a tu perfil</Label>
        <Input
          id="profile"
          value={profile}
          placeholder={PLACEHOLDER[platform]}
          onChange={(e) => setProfile(e.target.value)}
          aria-invalid={state.field === "profile"}
        />
        <p className="text-xs text-muted-foreground">
          Tu lista debe ser pública: tu giver la usará para no proponerte algo que ya viste.
        </p>
        {fieldError("profile")}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="episodes">Límite de episodios</Label>
        <div className="flex flex-wrap items-center gap-3">
          {EPISODE_PRESETS.map((preset) => (
            <label key={preset} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="episodes"
                checked={episodePreset === String(preset)}
                onChange={() => setEpisodePreset(String(preset))}
                className="accent-primary"
              />
              {preset}
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="episodes"
              checked={episodePreset === "other"}
              onChange={() => setEpisodePreset("other")}
              className="accent-primary"
            />
            Otro
          </label>
          {episodePreset === "other" && (
            <Input
              id="episodes"
              type="number"
              min={1}
              value={otherEpisodes}
              onChange={(e) => setOtherEpisodes(e.target.value)}
              className="w-24"
              aria-label="Límite de episodios"
            />
          )}
        </div>
        {fieldError("maxEpisodes")}
      </div>

      <TagPicker
        label="Tags baneados"
        hint="Lo que no quieres que te toque."
        options={tagOptions}
        value={bannedTags}
        onChange={setBannedTags}
        max={MAX_BANNED_TAGS}
        exclude={allowedTags}
        variant="destructive"
      />
      {fieldError("bannedTags")}

      <TagPicker
        label="Tags permitidos / preferidos"
        hint="Opcional: géneros o temas que te gustaría recibir."
        options={tagOptions}
        value={allowedTags}
        onChange={setAllowedTags}
        max={MAX_ALLOWED_TAGS}
        exclude={bannedTags}
      />
      {fieldError("allowedTags")}

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={allowPtw}
          onChange={(e) => setAllowPtw(e.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          Acepto animes de mi Plan to Watch
          <span className="block text-xs text-muted-foreground">
            Tu giver podrá proponerte algo que ya tenías pendiente.
          </span>
        </span>
      </label>

      {state.error && !state.field && <p className="text-sm text-destructive">{state.error}</p>}
      {state.ok && (
        <p className="text-sm text-success">
          {state.profileUsername
            ? `¡Listo! Inscrito como ${state.profileUsername}.`
            : "Listo."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Verificando perfil…" : isActive ? "Guardar cambios" : "Inscribirme"}
        </Button>

        {isActive &&
          (confirmWithdraw ? (
            <>
              <span className="text-sm">¿Seguro que quieres retirarte?</span>
              <Button type="button" variant="destructive" disabled={pending} onClick={withdraw}>
                Sí, retirarme
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmWithdraw(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmWithdraw(true)}>
              Retirarme
            </Button>
          ))}
      </div>
    </form>
  );
}
