"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { type EvidenceInput, evidenceSchema } from "@/lib/evidence";
import { type ReviewImage, reviewImagesSchema } from "@/lib/review-images";
import { isBlobConfigured, vercelBlobStore } from "@/server/blob-store";
import { defaultAnimeServices } from "@/server/anime-services";
import { saveEvidence } from "@/server/evidence";
import { addProposal, chooseProposal, removeProposal } from "@/server/proposals";
import { allowUserAction, RATE_LIMIT_MESSAGE } from "@/server/rate-limit";

export type ProposalActionState = { ok?: boolean; error?: string; warnings?: string[] };

export async function addProposalAction(link: string): Promise<ProposalActionState> {
  const user = await assertRole("user");
  if (typeof link !== "string" || link.length > 500) return { error: "Link inválido" };
  if (!(await allowUserAction(getDb(), user.id, "proposal"))) return { error: RATE_LIMIT_MESSAGE };
  const result = await addProposal(getDb(), {
    userId: user.id,
    link,
    now: new Date(),
    services: defaultAnimeServices,
  });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true, warnings: result.proposal.warnings };
}

export async function removeProposalAction(proposalId: string): Promise<ProposalActionState> {
  const user = await assertRole("user");
  if (!z.uuid().safeParse(proposalId).success) return { error: "Propuesta inválida" };
  if (!(await allowUserAction(getDb(), user.id, "proposal"))) return { error: RATE_LIMIT_MESSAGE };
  const result = await removeProposal(getDb(), { userId: user.id, proposalId, now: new Date() });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

export async function chooseProposalAction(proposalId: string): Promise<ProposalActionState> {
  const user = await assertRole("user");
  if (!z.uuid().safeParse(proposalId).success) return { error: "Propuesta inválida" };
  if (!(await allowUserAction(getDb(), user.id, "selection"))) return { error: RATE_LIMIT_MESSAGE };
  const result = await chooseProposal(getDb(), { userId: user.id, proposalId, now: new Date() });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

export type EvidenceActionState = { ok?: boolean; error?: string };

export async function saveEvidenceAction(
  raw: EvidenceInput,
  rawImages: ReviewImage[] = [],
): Promise<EvidenceActionState> {
  const user = await assertRole("user");
  if (!(await allowUserAction(getDb(), user.id, "evidence"))) return { error: RATE_LIMIT_MESSAGE };
  const parsed = evidenceSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const images = reviewImagesSchema.safeParse(rawImages);
  if (!images.success) return { error: images.error.issues[0].message };
  const result = await saveEvidence(getDb(), {
    userId: user.id,
    input: parsed.data,
    images: images.data,
    now: new Date(),
    blobStore: isBlobConfigured() ? vercelBlobStore() : null,
  });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}
