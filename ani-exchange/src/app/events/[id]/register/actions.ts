"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { verifyProfile } from "@/lib/profiles";
import {
  type RegistrationInput,
  registrationSchema,
  saveRegistration,
  withdrawRegistration,
} from "@/server/participants";
import { getTagCatalog } from "@/server/tag-catalog";

export type RegistrationState = {
  ok?: boolean;
  error?: string;
  field?: keyof RegistrationInput;
  /** Nombre canónico tras verificar, para mostrarlo al usuario. */
  profileUsername?: string;
};

export async function saveRegistrationAction(
  eventId: string,
  raw: RegistrationInput,
): Promise<RegistrationState> {
  const user = await assertRole("user");
  if (!z.uuid().safeParse(eventId).success) return { error: "Edición inválida" };

  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: issue.path[0] as keyof RegistrationInput };
  }

  let validTags: Set<string>;
  try {
    validTags = new Set((await getTagCatalog()).map((tag) => tag.name));
  } catch {
    return { error: "No pudimos cargar la lista de tags de AniList. Intenta de nuevo en un rato." };
  }

  const result = await saveRegistration(getDb(), {
    userId: user.id,
    eventId,
    input: parsed.data,
    now: new Date(),
    validTags,
    verify: (ref) => verifyProfile(ref),
  });
  if (!result.ok) return { error: result.error, field: result.field };

  refresh();
  return { ok: true, profileUsername: result.participant.profileUsername };
}

export async function withdrawRegistrationAction(eventId: string): Promise<RegistrationState> {
  const user = await assertRole("user");
  if (!z.uuid().safeParse(eventId).success) return { error: "Edición inválida" };
  const result = await withdrawRegistration(getDb(), { userId: user.id, eventId, now: new Date() });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}
