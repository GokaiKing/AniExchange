"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  type ParticipantActionState,
  removeFromCycleAction,
  resendParticipantDmAction,
  setParticipantStatusAction,
} from "./actions";

type Props = {
  participantId: string;
  status: "active" | "withdrawn" | "no_show";
  drawn: boolean;
  isSuperadmin: boolean;
  /** DM de asignación fallido que se puede reenviar. */
  failedDmId: string | null;
};

export function ParticipantRowActions({ participantId, status, drawn, isSuperadmin, failedDmId }: Props) {
  const [pending, startTransition] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState(false);

  const run = (fn: () => Promise<ParticipantActionState>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(result.message ?? "Listo");
      else if (result.error) toast.error(result.error);
      setConfirmRemove(false);
    });

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {failedDmId && (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => resendParticipantDmAction(failedDmId))}>
          Reenviar DM
        </Button>
      )}
      {status === "active" && (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setParticipantStatusAction(participantId, "no_show"))}>
          No participó
        </Button>
      )}
      {status !== "active" && (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setParticipantStatusAction(participantId, "active"))}>
          Reactivar
        </Button>
      )}
      {isSuperadmin && !drawn && status !== "withdrawn" && (
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => setParticipantStatusAction(participantId, "withdrawn"))}>
          Quitar
        </Button>
      )}
      {isSuperadmin &&
        drawn &&
        (confirmRemove ? (
          <>
            <Button size="xs" variant="destructive" disabled={pending} onClick={() => run(() => removeFromCycleAction(participantId, true))}>
              Confirmar
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            title="Quien le daba a esta persona pasa a darle a su receptor"
            onClick={() => setConfirmRemove(true)}
          >
            Sacar del ciclo
          </Button>
        ))}
    </div>
  );
}
