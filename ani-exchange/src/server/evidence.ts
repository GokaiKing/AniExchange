/**
 * Evidencia (review del receptor) y feed del home, spec §12.
 *
 * ANONIMATO: el feed y las vistas del receptor nunca seleccionan giver_id ni
 * datos del giver. El reveal (hito 8) los agrega cuando corresponda.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import {
  assignments,
  eventPhases,
  events,
  evidence,
  evidenceImages,
  participants,
  proposals,
  user,
} from "@/db/schema";
import type { EvidenceData } from "@/lib/evidence";
import {
  isOwnedBlobUrl,
  MAX_REVIEW_IMAGES,
  MAX_UPLOAD_BYTES,
  type ReviewImage,
  reviewImagePrefix,
  UPLOAD_CONTENT_TYPES,
} from "@/lib/review-images";
import type { BlobStore } from "./blob-store";
import { giversByAssignment, type Person } from "./reveal";
import { getCurrentEvent } from "./participants";
import { isPhaseActive } from "./phases";

export type EvidenceRow = typeof evidence.$inferSelect;
export type EvidenceWithImages = EvidenceRow & { images: ReviewImage[] };

async function imagesFor(db: Database, evidenceIds: string[]): Promise<Map<string, ReviewImage[]>> {
  const byEvidence = new Map<string, ReviewImage[]>();
  if (evidenceIds.length === 0) return byEvidence;
  const rows = await db
    .select()
    .from(evidenceImages)
    .where(inArray(evidenceImages.evidenceId, evidenceIds))
    .orderBy(asc(evidenceImages.position));
  for (const r of rows) {
    const list = byEvidence.get(r.evidenceId) ?? [];
    list.push({ url: r.url, thumbUrl: r.thumbUrl, width: r.width, height: r.height });
    byEvidence.set(r.evidenceId, list);
  }
  return byEvidence;
}

/** El anime que el receptor eligió (o le asignaron) para ver. */
export async function chosenAnime(db: Database, assignmentId: string) {
  const [row] = await db
    .select({
      title: proposals.title,
      episodes: proposals.episodes,
      sourceUrl: proposals.sourceUrl,
      coverUrl: proposals.coverUrl,
      autoChosen: proposals.autoChosen,
    })
    .from(proposals)
    .where(and(eq(proposals.assignmentId, assignmentId), eq(proposals.chosen, true)));
  return row ?? null;
}

export async function getEvidence(db: Database, assignmentId: string): Promise<EvidenceWithImages | null> {
  const [row] = await db.select().from(evidence).where(eq(evidence.assignmentId, assignmentId));
  if (!row) return null;
  return { ...row, images: (await imagesFor(db, [row.id])).get(row.id) ?? [] };
}

type Fail = { ok: false; error: string };

/**
 * Asignación donde el usuario es receptor y puede subir evidencia ahora:
 * fase de evidencia abierta, participante activo y anime elegido.
 */
async function myEvidenceAssignment(db: Database, userId: string, now: Date): Promise<{ ok: true; assignmentId: string } | Fail> {
  const current = await getCurrentEvent(db);
  if (!current) return { ok: false, error: "No hay un intercambio en curso" };

  const phase = current.phases.find((p) => p.key === "evidence");
  if (!phase || !isPhaseActive(phase, current.event, now)) {
    return { ok: false, error: "La fase de evidencia no está abierta" };
  }

  const [mine] = await db
    .select({ id: assignments.id, status: participants.status })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.receiverId))
    .where(
      and(
        eq(assignments.eventId, current.event.id),
        eq(participants.userId, userId),
        isNull(assignments.supersededBy),
      ),
    );
  if (!mine || mine.status !== "active") return { ok: false, error: "No tienes un anime asignado para reseñar" };
  if (!(await chosenAnime(db, mine.id))) return { ok: false, error: "No hay un anime elegido para esta asignación" };
  return { ok: true, assignmentId: mine.id };
}

const UPLOAD_PATHNAME = /^reviews\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,80}\.(webp|jpg)$/;

/** ¿Puede el usuario subir este archivo? (lo usa la ruta que emite tokens de Blob) */
export async function authorizeImageUpload(
  db: Database,
  params: { userId: string; pathname: string; now: Date },
): Promise<{ ok: true; assignmentId: string } | Fail> {
  const mine = await myEvidenceAssignment(db, params.userId, params.now);
  if (!mine.ok) return mine;
  if (!UPLOAD_PATHNAME.test(params.pathname) || !params.pathname.startsWith(reviewImagePrefix(mine.assignmentId))) {
    return { ok: false, error: "Ruta de subida inválida" };
  }
  return mine;
}

export async function saveEvidence(
  db: Database,
  params: {
    userId: string;
    input: EvidenceData;
    images?: ReviewImage[];
    now: Date;
    /** null = Blob no configurado: no se aceptan imágenes. */
    blobStore?: BlobStore | null;
  },
): Promise<{ ok: true; evidence: EvidenceWithImages } | Fail> {
  const mine = await myEvidenceAssignment(db, params.userId, params.now);
  if (!mine.ok) return mine;
  const images = params.images ?? [];
  const blobStore = params.blobStore ?? null;

  if (images.length > MAX_REVIEW_IMAGES) return { ok: false, error: `Máximo ${MAX_REVIEW_IMAGES} imágenes` };
  if (images.length > 0 && !blobStore) return { ok: false, error: "La subida de imágenes no está configurada" };
  for (const img of images) {
    if (!isOwnedBlobUrl(img.url, mine.assignmentId) || !isOwnedBlobUrl(img.thumbUrl, mine.assignmentId)) {
      return { ok: false, error: "Hay una imagen que no es tuya" };
    }
  }

  const previous = await getEvidence(db, mine.assignmentId);
  const previousUrls = new Set(previous?.images.flatMap((i) => [i.url, i.thumbUrl]) ?? []);

  // Verifica en Blob solo las imágenes nuevas.
  if (blobStore) {
    for (const url of images.flatMap((i) => [i.url, i.thumbUrl]).filter((u) => !previousUrls.has(u))) {
      const meta = await blobStore.head(url);
      if (!meta) return { ok: false, error: "Una imagen no terminó de subirse; vuelve a intentarlo" };
      if (!UPLOAD_CONTENT_TYPES.includes(meta.contentType) || meta.size > MAX_UPLOAD_BYTES) {
        return { ok: false, error: "Una imagen tiene un formato o tamaño no permitido" };
      }
    }
  }

  const values = {
    reviewText: params.input.reviewText,
    rating: params.input.rating === null ? null : params.input.rating.toFixed(1),
    trackerUrl: params.input.trackerUrl,
    containsSpoilers: params.input.containsSpoilers,
  };
  const row = await db.transaction(async (tx) => {
    const [saved] = await tx
      .insert(evidence)
      .values({ assignmentId: mine.assignmentId, ...values })
      .onConflictDoUpdate({ target: evidence.assignmentId, set: { ...values, updatedAt: params.now } })
      .returning();
    await tx.delete(evidenceImages).where(eq(evidenceImages.evidenceId, saved.id));
    if (images.length > 0) {
      await tx
        .insert(evidenceImages)
        .values(images.map((img, position) => ({ evidenceId: saved.id, position, ...img })));
    }
    return saved;
  });

  // Borrar de Blob las que se quitaron (si falla, la limpieza de huérfanas las recoge).
  const keptUrls = new Set(images.flatMap((i) => [i.url, i.thumbUrl]));
  const removed = [...previousUrls].filter((u) => !keptUrls.has(u));
  if (blobStore && removed.length > 0) {
    try {
      await blobStore.del(removed);
    } catch {
      // se limpiarán después
    }
  }

  return { ok: true, evidence: { ...row, images } };
}

/**
 * Borra de Blob las imágenes subidas hace más de `olderThanHours` que ninguna
 * review usa (subidas abandonadas o reemplazadas). Devuelve cuántas borró.
 */
export async function cleanupOrphanImages(
  db: Database,
  blobStore: BlobStore,
  now: Date = new Date(),
  olderThanHours = 24,
): Promise<number> {
  const cutoff = now.getTime() - olderThanHours * 3600 * 1000;
  const blobs = await blobStore.list("reviews/");
  const used = await db.select({ url: evidenceImages.url, thumbUrl: evidenceImages.thumbUrl }).from(evidenceImages);
  const usedUrls = new Set(used.flatMap((r) => [r.url, r.thumbUrl]));
  const orphans = blobs.filter((b) => b.uploadedAt.getTime() < cutoff && !usedUrls.has(b.url)).map((b) => b.url);
  await blobStore.del(orphans);
  return orphans.length;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

export type FeedItem = {
  id: string;
  anime: { title: string; episodes: number | null; sourceUrl: string; coverUrl: string | null };
  reviewer: { name: string; image: string | null };
  reviewText: string;
  rating: number | null;
  trackerUrl: string | null;
  containsSpoilers: boolean;
  images: ReviewImage[];
  createdAt: Date;
  /** Solo después del reveal. */
  giver?: Person;
};

/**
 * Reviews de la edición, más recientes primero. El giver se agrega con una
 * consulta aparte y SOLO si `revealed` es true.
 */
export async function listFeed(
  db: Database,
  eventId: string,
  options: { revealed?: boolean } = {},
): Promise<FeedItem[]> {
  const rows = await db
    .select({
      id: evidence.id,
      assignmentId: evidence.assignmentId,
      reviewText: evidence.reviewText,
      rating: evidence.rating,
      trackerUrl: evidence.trackerUrl,
      containsSpoilers: evidence.containsSpoilers,
      createdAt: evidence.createdAt,
      reviewerName: user.name,
      reviewerImage: user.image,
      title: proposals.title,
      episodes: proposals.episodes,
      sourceUrl: proposals.sourceUrl,
      coverUrl: proposals.coverUrl,
    })
    .from(evidence)
    .innerJoin(assignments, eq(assignments.id, evidence.assignmentId))
    .innerJoin(participants, eq(participants.id, assignments.receiverId)) // ← receptor, nunca el giver
    .innerJoin(user, eq(user.id, participants.userId))
    .innerJoin(proposals, and(eq(proposals.assignmentId, assignments.id), eq(proposals.chosen, true)))
    .where(and(eq(assignments.eventId, eventId), isNull(assignments.supersededBy)))
    .orderBy(desc(evidence.createdAt));

  const images = await imagesFor(
    db,
    rows.map((r) => r.id),
  );
  const givers = options.revealed
    ? await giversByAssignment(
        db,
        rows.map((r) => r.assignmentId),
      )
    : null;
  return rows.map((r) => ({
    id: r.id,
    anime: { title: r.title, episodes: r.episodes, sourceUrl: r.sourceUrl, coverUrl: r.coverUrl },
    reviewer: { name: r.reviewerName, image: r.reviewerImage },
    reviewText: r.reviewText,
    rating: r.rating === null ? null : Number(r.rating),
    trackerUrl: r.trackerUrl,
    containsSpoilers: r.containsSpoilers,
    images: images.get(r.id) ?? [],
    createdAt: r.createdAt,
    ...(givers?.has(r.assignmentId) ? { giver: givers.get(r.assignmentId) } : {}),
  }));
}

/** ¿Quién puede ver el feed? Por defecto solo usuarios con sesión. */
export function canSeeFeed(event: Pick<typeof events.$inferSelect, "feedPublic">, loggedIn: boolean): boolean {
  return event.feedPublic || loggedIn;
}

/** ¿El receptor puede subir/editar evidencia ahora? */
export function evidenceOpen(
  event: typeof events.$inferSelect,
  phases: (typeof eventPhases.$inferSelect)[],
  now: Date,
): boolean {
  const phase = phases.find((p) => p.key === "evidence");
  return Boolean(phase && isPhaseActive(phase, event, now));
}
