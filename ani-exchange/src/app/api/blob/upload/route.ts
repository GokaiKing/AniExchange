import { type HandleUploadBody, handleUpload } from "@vercel/blob/client";
import { getDb } from "@/db";
import { getSessionUser } from "@/lib/authz";
import { getEnv } from "@/lib/env";
import { MAX_UPLOAD_BYTES, UPLOAD_CONTENT_TYPES } from "@/lib/review-images";
import { authorizeImageUpload } from "@/server/evidence";

/**
 * Emite tokens para que el navegador suba imágenes de reviews directo a
 * Vercel Blob. Solo a la carpeta de la propia asignación, durante la fase de
 * evidencia. No usamos el callback de "subida completada" (no funciona en
 * localhost): el servidor verifica cada imagen al guardar la review.
 */
export async function POST(request: Request): Promise<Response> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ error: "Subida de imágenes no configurada" }, { status: 503 });

  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }
  if (body.type !== "blob.generate-client-token") {
    return Response.json({ error: "Evento no soportado" }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      token,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const auth = await authorizeImageUpload(getDb(), { userId: user.id, pathname, now: new Date() });
        if (!auth.ok) throw new Error(auth.error);
        return {
          allowedContentTypes: UPLOAD_CONTENT_TYPES,
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          addRandomSuffix: true,
          allowOverwrite: false,
          cacheControlMaxAge: 60 * 60 * 24 * 365,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
