"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { assertRole } from "@/lib/authz";
import { ParticipantActionError, removeFromCycle, setParticipantStatus } from "@/server/admin-participants";
import { resendNotification } from "@/server/notifications";

export type ParticipantActionState = { ok?: boolean; message?: string; error?: string };

const statusSchema = z.enum(["active", "no_show", "withdrawn"]);

async function run(fn: () => Promise<string>): Promise<ParticipantActionState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message };
  } catch (error) {
    if (error instanceof ParticipantActionError) return { error: error.message };
    throw error;
  }
}

/** admin: no participó / reactivar. superadmin: además quitar (antes del sorteo). */
export async function setParticipantStatusAction(participantId: string, status: string): Promise<ParticipantActionState> {
  const parsedStatus = statusSchema.safeParse(status);
  if (!z.uuid().safeParse(participantId).success || !parsedStatus.success) return { error: "Datos inválidos" };
  const user = await assertRole(parsedStatus.data === "withdrawn" ? "superadmin" : "admin");
  return run(async () => {
    await setParticipantStatus(getDb(), user.id, participantId, parsedStatus.data);
    return { active: "Participante reactivado", no_show: "Marcado como no participó", withdrawn: "Participante quitado" }[
      parsedStatus.data
    ];
  });
}

/** superadmin: W → X → R pasa a W → R. */
export async function removeFromCycleAction(participantId: string, confirmed: boolean): Promise<ParticipantActionState> {
  const user = await assertRole("superadmin");
  if (!confirmed) return { error: "Confirma la acción" };
  if (!z.uuid().safeParse(participantId).success) return { error: "Datos inválidos" };
  return run(async () => {
    await removeFromCycle(getDb(), user.id, participantId);
    return "Fuera del ciclo. Quien le daba ahora le da a su receptor (se le envió un DM).";
  });
}

/** admin: reenviar el DM de asignación de alguien. */
export async function resendParticipantDmAction(notificationId: string): Promise<ParticipantActionState> {
  const user = await assertRole("admin");
  if (!z.uuid().safeParse(notificationId).success) return { error: "DM inválido" };
  const ok = await resendNotification(getDb(), user.id, notificationId);
  refresh();
  return ok ? { ok: true, message: "DM en cola de nuevo" } : { error: "Ese DM ya no se puede reenviar" };
}
