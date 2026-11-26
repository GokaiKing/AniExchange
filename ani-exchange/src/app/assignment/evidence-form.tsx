"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REVIEW_MAX, REVIEW_MIN } from "@/lib/evidence";
import type { ReviewImage } from "@/lib/review-images";
import { ImagePicker } from "./image-picker";
import { type EvidenceActionState, saveEvidenceAction } from "./actions";

type Initial = {
  reviewText: string;
  rating: number | null;
  trackerUrl: string | null;
  containsSpoilers: boolean;
  images: ReviewImage[];
};

type Props = {
  initial: Initial | null;
  assignmentId: string;
  /** false si no hay Vercel Blob configurado. */
  imagesEnabled: boolean;
};

export function EvidenceForm({ initial, assignmentId, imagesEnabled }: Props) {
  const [reviewText, setReviewText] = useState(initial?.reviewText ?? "");
  const [rating, setRating] = useState(initial?.rating === null || !initial ? "" : String(initial.rating));
  const [trackerUrl, setTrackerUrl] = useState(initial?.trackerUrl ?? "");
  const [containsSpoilers, setContainsSpoilers] = useState(initial?.containsSpoilers ?? false);
  const [images, setImages] = useState<ReviewImage[]>(initial?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [state, setState] = useState<EvidenceActionState>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const submit = () =>
    startTransition(async () => {
      const result = await saveEvidenceAction(
        {
          reviewText,
          rating: rating.trim() === "" ? null : Number(rating),
          trackerUrl,
          containsSpoilers,
        },
        images,
      );
      setState(result);
      if (!result.ok) return;
      if (initial) {
        toast.success("Review actualizada");
      } else {
        // Primera publicación: al home, donde queda hasta arriba del feed.
        toast.success("Publicado con éxito");
        router.push("/");
      }
    });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="review">¿Qué te pareció?</Label>
        <textarea
          id="review"
          value={reviewText}
          onChange={(e) => setReviewText(e.target.value)}
          rows={6}
          maxLength={REVIEW_MAX}
          placeholder="Puedes usar **negritas**, _cursivas_, listas y links."
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          {reviewText.trim().length}/{REVIEW_MAX} · mínimo {REVIEW_MIN} caracteres
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="rating">Calificación (opcional)</Label>
          <Input
            id="rating"
            type="number"
            min={0}
            max={10}
            step={0.5}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="w-24"
            placeholder="0–10"
          />
        </div>
        <div className="grid min-w-60 flex-1 gap-1.5">
          <Label htmlFor="tracker">Link a tu entrada Completed (opcional)</Label>
          <Input
            id="tracker"
            value={trackerUrl}
            onChange={(e) => setTrackerUrl(e.target.value)}
            placeholder="https://anilist.co/… o https://myanimelist.net/…"
          />
        </div>
      </div>

      {imagesEnabled && (
        <ImagePicker
          assignmentId={assignmentId}
          images={images}
          onChange={setImages}
          disabled={pending}
          onBusyChange={setUploading}
        />
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={containsSpoilers}
          onChange={(e) => setContainsSpoilers(e.target.checked)}
          className="size-4 accent-primary"
        />
        Contiene spoilers (se mostrará colapsada en el feed)
      </label>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div>
        <Button type="submit" disabled={pending || uploading}>
          {pending ? "Guardando…" : initial ? "Guardar cambios" : "Publicar review"}
        </Button>
      </div>
    </form>
  );
}
