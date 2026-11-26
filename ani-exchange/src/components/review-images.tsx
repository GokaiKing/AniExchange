import type { ReviewImage } from "@/lib/review-images";

/** Miniaturas de una review; cada una abre la imagen completa en otra pestaña. */
export function ReviewImages({ images }: { images: ReviewImage[] }) {
  if (images.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {images.map((img, i) => (
        <a key={img.url} href={img.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border">
          {/* eslint-disable-next-line @next/next/no-img-element -- miniatura en Vercel Blob */}
          <img
            src={img.thumbUrl}
            alt={`Imagen ${i + 1} de la review`}
            loading="lazy"
            className="aspect-square w-full object-cover transition-transform hover:scale-105"
          />
        </a>
      ))}
    </div>
  );
}
