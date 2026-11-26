"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { defaultAnimeServices } from "@/server/anime-services";
import { addProposal, chooseProposal, removeProposal } from "@/server/proposals";

export type ProposalActionState = { ok?: boolean; error?: string; warnings?: string[] };

export async function addProposalAction(link: string): Promise<ProposalActionState> {
  const user = await assertRole("user");
  if (typeof link !== "string" || link.length > 500) return { error: "Link inválido" };
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
  const result = await removeProposal(getDb(), { userId: user.id, proposalId, now: new Date() });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

export async function chooseProposalAction(proposalId: string): Promise<ProposalActionState> {
  const user = await assertRole("user");
  if (!z.uuid().safeParse(proposalId).success) return { error: "Propuesta inválida" };
  const result = await chooseProposal(getDb(), { userId: user.id, proposalId, now: new Date() });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}
