/**
 * Re-codifica una imagen en el navegador: la escala, la convierte a WebP (o
 * JPEG si el navegador no codifica WebP) y, al pasar por un canvas, descarta
 * los metadatos EXIF (incluida la ubicación GPS). Solo navegador.
 */
export type EncodedImage = { blob: Blob; width: number; height: number; extension: "webp" | "jpg" };

async function encode(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<EncodedImage> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no puede procesar imágenes");
  ctx.drawImage(bitmap, 0, 0, width, height);

  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  let blob = await toBlob("image/webp");
  let extension: EncodedImage["extension"] = "webp";
  if (!blob || blob.type !== "image/webp") {
    blob = await toBlob("image/jpeg");
    extension = "jpg";
  }
  if (!blob) throw new Error("No se pudo convertir la imagen");
  return { blob, width, height, extension };
}

/** Versión completa y miniatura de un archivo de imagen. */
export async function prepareReviewImage(
  file: File,
  sizes: { full: number; thumb: number },
): Promise<{ full: EncodedImage; thumb: EncodedImage }> {
  // imageOrientation "from-image" respeta la rotación del EXIF antes de descartarlo.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const full = await encode(bitmap, sizes.full, 0.82);
    const thumb = await encode(bitmap, sizes.thumb, 0.75);
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}
