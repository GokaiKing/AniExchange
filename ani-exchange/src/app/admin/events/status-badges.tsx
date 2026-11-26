import { Badge } from "@/components/ui/badge";
import type { PhaseStatus } from "@/db/schema";

const PHASE_STATUS: Record<PhaseStatus, { label: string; variant: "outline" | "default" | "secondary" }> = {
  pending: { label: "Pendiente", variant: "outline" },
  open: { label: "Abierta", variant: "default" },
  closed: { label: "Cerrada", variant: "secondary" },
};

export function PhaseStatusBadge({ status }: { status: PhaseStatus }) {
  const { label, variant } = PHASE_STATUS[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function EventFlagBadges({ paused, archived }: { paused: boolean; archived: boolean }) {
  return (
    <>
      {paused && <Badge variant="destructive">Pausada</Badge>}
      {archived && <Badge variant="secondary">Archivada</Badge>}
    </>
  );
}
