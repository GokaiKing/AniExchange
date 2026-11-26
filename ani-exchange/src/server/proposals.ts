/**
 * Propuestas (giver) y elección (receptor), spec §11.
 *
 * ANONIMATO: las funciones del receptor devuelven solo datos del anime; nunca
 * giver_id ni datos del giver.
 */
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db";
import { assignments, eventPhases, events, participants, proposals } from "@/db/schema";
import { parseAnimeLink } from "@/lib/anime";
import type { AnimeServices } from "./anime-services";
import { getCurrentEvent } from "./participants";
import { isPhaseActive } from "./phases";
import { checkMedia, listWarnings, MAX_PROPOSALS, missesPreferred } from "./proposal-rules";

export type ProposalRow = typeof proposals.$inferSelect;

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type Role = "giver" | "receiver";

/** Asignación vigente del usuario en la edición actual, en el rol pedido. */
async function myAssignment(db: Database, userId: string, role: Role) {
  const current = await getCurrentEvent(db);
  if (!current) return null;
  const [row] = await db
    .select({ assignment: assignments, participantStatus: participants.status })
    .from(assignments)
    .innerJoin(
      participants,
      eq(participants.id, role === "giver" ? assignments.giverId : assignments.receiverId),
    )
    .where(
      and(
        eq(assignments.eventId, current.event.id),
        eq(participants.userId, userId),
        isNull(assignments.supersededBy),
      ),
    );
  if (!row || row.participantStatus !== "active") return null;
  return { ...current, assignment: row.assignment };
}

function phaseIsActive(
  data: { event: typeof events.$inferSelect; phases: (typeof eventPhases.$inferSelect)[] },
  key: "proposals" | "selection",
  now: Date,
): boolean {
  const phase = data.phases.find((p) => p.key === key);
  return Boolean(phase && isPhaseActive(phase, data.event, now));
}

// ---------------------------------------------------------------------------
// Giver
// ---------------------------------------------------------------------------

export async function listGiverProposals(db: Database, assignmentId: string): Promise<ProposalRow[]> {
  return db
    .select()
    .from(proposals)
    .where(eq(proposals.assignmentId, assignmentId))
    .orderBy(asc(proposals.createdAt));
}

export async function addProposal(
  db: Database,
  params: { userId: string; link: string; now: Date; services: AnimeServices },
): Promise<ActionResult<{ proposal: ProposalRow }>> {
  const mine = await myAssignment(db, params.userId, "giver");
  if (!mine) return { ok: false, error: "No tienes una asignación vigente" };
  if (!phaseIsActive(mine, "proposals", params.now)) {
    return { ok: false, error: "La fase de propuestas no está abierta" };
  }

  const ref = parseAnimeLink(params.link);
  if (!ref) {
    return { ok: false, error: "Pega un link de anime de AniList o MyAnimeList (…/anime/123)" };
  }

  const [receiver] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, mine.assignment.receiverId));

  let media;
  try {
    media = await params.services.fetchMedia(ref);
  } catch {
    return { ok: false, error: "No pudimos consultar AniList. Intenta de nuevo en un momento." };
  }
  if (!media) return { ok: false, error: "AniList no encontró ese anime" };

  const rules = {
    maxEpisodes: receiver.maxEpisodes,
    bannedTags: receiver.bannedTags,
    allowPtw: receiver.allowPtw,
  };
  const check = checkMedia(media, rules);
  if (check.errors.length > 0) return { ok: false, error: check.errors.join(" · ") };

  const warnings = [...check.warnings];
  try {
    const status = await params.services.listStatus(receiver.platform, receiver.profileUsername, media);
    warnings.push(...listWarnings(status, rules));
  } catch {
    warnings.push("No pudimos revisar su lista; confirma que no lo haya visto");
  }

  return db.transaction(async (tx) => {
    // Bloquea la asignación para validar el máximo de 3 sin carreras.
    await tx.select({ id: assignments.id }).from(assignments).where(eq(assignments.id, mine.assignment.id)).for("update");
    const existing = await tx.select().from(proposals).where(eq(proposals.assignmentId, mine.assignment.id));
    if (existing.length >= MAX_PROPOSALS) {
      return { ok: false as const, error: `Ya tienes ${MAX_PROPOSALS} propuestas; quita una para agregar otra` };
    }
    if (existing.some((p) => p.anilistId === media.id)) {
      return { ok: false as const, error: "Ya propusiste ese anime" };
    }
    const [proposal] = await tx
      .insert(proposals)
      .values({
        assignmentId: mine.assignment.id,
        anilistId: media.id,
        malId: media.idMal,
        title: media.title,
        episodes: media.episodes,
        sourceUrl: media.siteUrl,
        coverUrl: media.coverUrl,
        warnings,
        missesPreferred: missesPreferred(media, receiver.allowedTags),
      })
      .returning();
    return { ok: true as const, proposal };
  });
}

export async function removeProposal(
  db: Database,
  params: { userId: string; proposalId: string; now: Date },
): Promise<ActionResult> {
  const mine = await myAssignment(db, params.userId, "giver");
  if (!mine) return { ok: false, error: "No tienes una asignación vigente" };
  if (!phaseIsActive(mine, "proposals", params.now)) {
    return { ok: false, error: "La fase de propuestas ya no está abierta" };
  }
  const deleted = await db
    .delete(proposals)
    .where(and(eq(proposals.id, params.proposalId), eq(proposals.assignmentId, mine.assignment.id)))
    .returning({ id: proposals.id });
  return deleted.length > 0 ? { ok: true } : { ok: false, error: "Esa propuesta no es tuya" };
}

// ---------------------------------------------------------------------------
// Receptor
// ---------------------------------------------------------------------------

/** Lo que ve el receptor de cada propuesta: solo el anime. */
export type ReceiverProposal = {
  id: string;
  title: string;
  episodes: number | null;
  sourceUrl: string;
  coverUrl: string | null;
  chosen: boolean;
  autoChosen: boolean;
};

export async function listReceiverProposals(db: Database, assignmentId: string): Promise<ReceiverProposal[]> {
  return db
    .select({
      id: proposals.id,
      title: proposals.title,
      episodes: proposals.episodes,
      sourceUrl: proposals.sourceUrl,
      coverUrl: proposals.coverUrl,
      chosen: proposals.chosen,
      autoChosen: proposals.autoChosen,
    })
    .from(proposals)
    .where(eq(proposals.assignmentId, assignmentId))
    .orderBy(asc(proposals.createdAt));
}

export async function chooseProposal(
  db: Database,
  params: { userId: string; proposalId: string; now: Date },
): Promise<ActionResult> {
  const mine = await myAssignment(db, params.userId, "receiver");
  if (!mine) return { ok: false, error: "No tienes una asignación vigente" };
  if (!phaseIsActive(mine, "selection", params.now)) {
    return { ok: false, error: "La fase de elección no está abierta" };
  }
  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.id, params.proposalId), eq(proposals.assignmentId, mine.assignment.id)));
    if (!target) return { ok: false as const, error: "Esa propuesta no es para ti" };
    // Primero desmarcar (el índice único permite un solo chosen por asignación).
    await tx
      .update(proposals)
      .set({ chosen: false, autoChosen: false })
      .where(eq(proposals.assignmentId, mine.assignment.id));
    await tx.update(proposals).set({ chosen: true }).where(eq(proposals.id, target.id));
    return { ok: true as const };
  });
}

/** Cuántas propuestas tiene una asignación (para la vista del receptor). */
export async function proposalCount(db: Database, assignmentId: string): Promise<number> {
  const [{ total }] = await db.select({ total: count() }).from(proposals).where(eq(proposals.assignmentId, assignmentId));
  return total;
}
