"use client";

import { upload } from "@vercel/blob/client";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { prepareReviewImage } from "@/lib/compress-image";
import {
  FULL_MAX_SIDE,
  MAX_REVIEW_IMAGES,
  MAX_SOURCE_BYTES,
  type ReviewImage,
  reviewImagePrefix,
  THUMB_MAX_SIDE,
} from "@/lib/review-images";

type Props = {
  assignmentId: string;
  images: ReviewImage[];
  onChange: (images: ReviewImage[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

/** Hasta 4 imágenes: se comprimen en el navegador y se suben directo a Vercel Blob. */
export function ImagePicker({ assignmentId, images, onChange, disabled, onBusyChange }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const remaining = MAX_REVIEW_IMAGES - images.length - uploading;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const selected = [...files].slice(0, Math.max(0, remaining));
    if (files.length > selected.length) setError(`Máximo ${MAX_REVIEW_IMAGES} imágenes`);

    setUploading((n) => n + selected.length);
    onBusyChange?.(true);
    const added: ReviewImage[] = [];
    for (const file of selected) {
      try {
        if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
          throw new Error(`"${file.name}" no es una imagen compatible`);
        }
        if (file.size > MAX_SOURCE_BYTES) throw new Error(`"${file.name}" pesa demasiado`);
        const { full, thumb } = await prepareReviewImage(file, { full: FULL_MAX_SIDE, thumb: THUMB_MAX_SIDE });
        const base = `${reviewImagePrefix(assignmentId)}${crypto.randomUUID()}`;
        const opts = { access: "public" as const, handleUploadUrl: "/api/blob/upload" };
        const [fullResult, thumbResult] = await Promise.all([
          upload(`${base}.${full.extension}`, full.blob, { ...opts, contentType: full.blob.type }),
          upload(`${base}_thumb.${thumb.extension}`, thumb.blob, { ...opts, contentType: thumb.blob.type }),
        ]);
        added.push({ url: fullResult.url, thumbUrl: thumbResult.url, width: full.width, height: full.height });
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo subir una imagen");
      } finally {
        setUploading((n) => n - 1);
      }
    }
    onChange([...images, ...added]);
    onBusyChange?.(false);
    if (input.current) input.current.value = "";
  };

  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium">
        Imágenes <span className="font-normal text-muted-foreground">(opcional, {images.length}/{MAX_REVIEW_IMAGES})</span>
      </span>
      <div className="flex flex-wrap gap-2">
        {images.map((img, i) => (
          <div key={img.url} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- miniatura en Vercel Blob */}
            <img src={img.thumbUrl} alt={`Imagen ${i + 1}`} className="size-20 rounded-md border object-cover" />
            <button
              type="button"
              aria-label={`Quitar imagen ${i + 1}`}
              disabled={disabled || uploading > 0}
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 rounded-full border bg-background p-0.5 hover:bg-muted"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
        {Array.from({ length: uploading }, (_, i) => (
          <div key={`up-${i}`} className="flex size-20 animate-pulse items-center justify-center rounded-md border text-xs text-muted-foreground">
            Subiendo…
          </div>
        ))}
        {remaining > 0 && (
          <Button
            type="button"
            variant="outline"
            className="size-20 flex-col text-xs"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            + Agregar
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        hidden
        onChange={(e) => handleFiles(e.target.files)}
      />
      <p className="text-xs text-muted-foreground">
        Se reducen y convierten antes de subir; se borra la ubicación y demás datos de la foto. Los GIF quedan sin
        animación.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
