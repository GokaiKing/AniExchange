import { LocalTime } from "@/components/local-time";
import { formatAppDateTime } from "@/lib/dates";

/** "8 dic, 23:59 (horario del vendehumo del admin) · tu hora: 9 dic, 03:59" */
export function AppDateTime({ date }: { date: Date }) {
  return (
    <>
      {formatAppDateTime(date)}
      <LocalTime iso={date.toISOString()} />
    </>
  );
}
