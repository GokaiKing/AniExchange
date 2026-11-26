/**
 * Políticas on_miss al cerrar propuestas y elección (spec §6, §11). Se ejecutan
 * dentro de la transacción del tick, con la edición bloqueada.
 */
import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { Transaction } from "@/db";
import { assignments, participants, proposals } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import type { AnimeServices } from "./anime-services";
import type { EventRow, PhaseRow } from "./events";
import { enqueueAdminAlert } from "./notifications";
import { checkMedia, missesPreferred } from "./proposal-rules";

/** Cuántos candidatos del PTW se revisan como máximo (limita llamadas a AniList). */
const PTW_MAX_CANDIDATES = 10;

export type OnMissSummary = { policy: string; affected: number; needsAttention: number };

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function activeAssignments(tx: Transaction, eventId: string) {
  return tx
    .select({ assignment: assignments })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.giverId))
    .where(
      and(
        eq(assignments.eventId, eventId),
        isNull(assignments.supersededBy),
        eq(participants.status, "active"),
      ),
    );
}

async function markNoShow(tx: Transaction, participantId: string) {
  await tx.update(participants).set({ status: "no_show" }).where(eq(participants.id, participantId));
}

/** Intenta agregar un anime válido del PTW del receptor. true si lo logró. */
async function proposeFromPtw(
  tx: Transaction,
  assignmentId: string,
  receiverId: string,
  services: AnimeServices,
): Promise<boolean> {
  const [receiver] = await tx.select().from(participants).where(eq(participants.id, receiverId));
  if (!receiver || !receiver.allowPtw) return false;
  try {
    const refs = shuffled(await services.planToWatch(receiver.platform, receiver.profileUsername));
    for (const ref of refs.slice(0, PTW_MAX_CANDIDATES)) {
      const media = await services.fetchMedia(ref);
      if (!media) continue;
      const { errors } = checkMedia(media, {
        maxEpisodes: receiver.maxEpisodes,
        bannedTags: receiver.bannedTags,
        allowPtw: receiver.allowPtw,
      });
      if (errors.length > 0) continue;
      await tx.insert(proposals).values({
        assignmentId,
        anilistId: media.id,
        malId: media.idMal,
        title: media.title,
        episodes: media.episodes,
        sourceUrl: media.siteUrl,
        coverUrl: media.coverUrl,
        autoAdded: true,
        warnings: ["Propuesta automática de su Plan to Watch"],
        missesPreferred: missesPreferred(media, receiver.allowedTags),
      });
      return true;
    }
  } catch {
    // Servicio externo caído: se trata como "no se pudo" y se avisa al admin.
  }
  return false;
}

/** Cierre de propuestas: givers sin ninguna propuesta. */
export async function applyProposalsOnMiss(
  tx: Transaction,
  event: EventRow,
  phase: PhaseRow,
  services: AnimeServices,
): Promise<OnMissSummary> {
  const policy = phase.onMiss ?? "mark_no_show";
  const rows = await activeAssignments(tx, event.id);
  const withProposals = new Set(
    rows.length === 0
      ? []
      : (
          await tx
            .select({ assignmentId: proposals.assignmentId })
            .from(proposals)
            .where(inArray(proposals.assignmentId, rows.map((r) => r.assignment.id)))
        ).map((p) => p.assignmentId),
  );
  const missing = rows.filter((r) => !withProposals.has(r.assignment.id));

  let needsAttention = 0;
  for (const { assignment } of missing) {
    let result: string;
    if (policy === "random_from_ptw" && (await proposeFromPtw(tx, assignment.id, assignment.receiverId, services))) {
      result = "ptw_added";
    } else {
      // reassign queda como reasignación manual desde el panel (hito 8).
      await markNoShow(tx, assignment.giverId);
      result = policy === "reassign" ? "needs_reassign" : policy === "random_from_ptw" ? "ptw_failed_no_show" : "no_show";
      needsAttention++;
    }
    await writeAudit(tx, {
      actorId: null,
      action: "on_miss.proposals",
      entity: "assignment",
      entityId: assignment.id,
      after: { policy, result },
    });
  }

  if (needsAttention > 0) {
    await enqueueAdminAlert(
      tx,
      event.id,
      "admin_alert",
      { type: "on_miss", phase: phase.key, policy, count: needsAttention },
      `${event.id}:on_miss:${phase.key}`,
    );
  }
  return { policy, affected: missing.length, needsAttention };
}

/** Cierre de elección: receptores con propuestas que no eligieron. */
export async function applySelectionOnMiss(tx: Transaction, event: EventRow, phase: PhaseRow): Promise<OnMissSummary> {
  const policy = phase.onMiss ?? "random_option";
  const rows = await tx
    .select({ assignment: assignments })
    .from(assignments)
    .innerJoin(participants, eq(participants.id, assignments.receiverId))
    .where(
      and(
        eq(assignments.eventId, event.id),
        isNull(assignments.supersededBy),
        eq(participants.status, "active"),
      ),
    );

  let affected = 0;
  let needsAttention = 0;
  for (const { assignment } of rows) {
    const options = await tx
      .select()
      .from(proposals)
      .where(eq(proposals.assignmentId, assignment.id))
      .orderBy(asc(proposals.createdAt));
    if (options.length === 0 || options.some((p) => p.chosen)) continue;
    affected++;

    let result: string;
    if (policy === "first_option" || policy === "random_option") {
      const pick = policy === "first_option" ? options[0] : options[randomInt(options.length)];
      await tx.update(proposals).set({ chosen: true, autoChosen: true }).where(eq(proposals.id, pick.id));
      result = `auto_chosen:${pick.id}`;
    } else {
      await markNoShow(tx, assignment.receiverId);
      result = "no_show";
      needsAttention++;
    }
    await writeAudit(tx, {
      actorId: null,
      action: "on_miss.selection",
      entity: "assignment",
      entityId: assignment.id,
      after: { policy, result },
    });
  }

  if (needsAttention > 0) {
    await enqueueAdminAlert(
      tx,
      event.id,
      "admin_alert",
      { type: "on_miss", phase: phase.key, policy, count: needsAttention },
      `${event.id}:on_miss:${phase.key}`,
    );
  }
  return { policy, affected, needsAttention };
}
