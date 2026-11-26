/** Imágenes de reviews (Vercel Blob). Compartido entre cliente y servidor. */
import { z } from "zod";

export const MAX_REVIEW_IMAGES = 4;
/** Tamaño máximo del archivo original que se acepta para comprimir (antes de subir). */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
/** Tamaño máximo ya comprimido (lo que el token de subida permite). */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const FULL_MAX_SIDE = 1600;
export const THUMB_MAX_SIDE = 400;
/** Formatos que el navegador produce al re-codificar (Safari viejo cae a JPEG). */
export const UPLOAD_CONTENT_TYPES = ["image/webp", "image/jpeg"];

/** Carpeta de las imágenes de una asignación. */
export function reviewImagePrefix(assignmentId: string): string {
  return `reviews/${assignmentId}/`;
}

/** ¿La URL es de nuestro Blob público y de esta asignación? */
export function isOwnedBlobUrl(raw: string, assignmentId: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.endsWith(".public.blob.vercel-storage.com") &&
    url.pathname.startsWith(`/${reviewImagePrefix(assignmentId)}`) &&
    !url.search &&
    !url.hash
  );
}

export const reviewImageSchema = z.object({
  url: z.url(),
  thumbUrl: z.url(),
  width: z.number().int().min(1).max(10_000),
  height: z.number().int().min(1).max(10_000),
});

export const reviewImagesSchema = z
  .array(reviewImageSchema)
  .max(MAX_REVIEW_IMAGES, `Máximo ${MAX_REVIEW_IMAGES} imágenes`);

export type ReviewImage = z.infer<typeof reviewImageSchema>;
