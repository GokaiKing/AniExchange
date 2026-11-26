import type { PhaseRow } from "@/server/events";
import { formatAppDate } from "@/lib/dates";
import { PHASE_LABEL } from "@/server/phases";

const COLORS = [
  "bg-sky-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-fuchsia-500",
];

/** Vista previa de las fases en una línea de tiempo horizontal. */
export function Timeline({ phases, now }: { phases: PhaseRow[]; now: Date }) {
  const start = Math.min(...phases.map((p) => p.startsAt.getTime()));
  const end = Math.max(...phases.map((p) => p.endsAt.getTime()));
  const span = end - start || 1;
  const pct = (t: number) => ((t - start) / span) * 100;
  const nowPct = pct(now.getTime());

  return (
    <div className="space-y-2">
      <div className="relative space-y-1.5">
        {phases.map((phase, i) => (
          <div key={phase.id} className="relative h-6">
            <div
              className={`absolute inset-y-0 flex items-center overflow-hidden rounded px-2 text-xs font-medium text-white ${COLORS[i % COLORS.length]} ${phase.enabled ? "" : "opacity-30"}`}
              style={{
                left: `${pct(phase.startsAt.getTime())}%`,
                width: `max(${pct(phase.endsAt.getTime()) - pct(phase.startsAt.getTime())}%, 0.25rem)`,
              }}
              title={`${PHASE_LABEL[phase.key]}: ${formatAppDate(phase.startsAt)} – ${formatAppDate(phase.endsAt)}`}
            >
              <span className="truncate">{PHASE_LABEL[phase.key]}</span>
            </div>
          </div>
        ))}
        {nowPct >= 0 && nowPct <= 100 && (
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
            style={{ left: `${nowPct}%` }}
            title="Hoy"
          />
        )}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatAppDate(new Date(start))}</span>
        <span>{formatAppDate(new Date(end))}</span>
      </div>
    </div>
  );
}
