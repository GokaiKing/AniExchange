/**
 * Etiqueta de la zona de referencia (America/Hermosillo) ante los
 * participantes — chiste local. Módulo sin dependencias para poder usarlo en
 * componentes de cliente sin cargar la librería de fechas.
 */
export const APP_TIME_LABEL = "horario del vendehumo del admin";

/** "2026-12-31" → "31 dic, 23:59 (horario del vendehumo del admin)", sin depender de la zona del navegador. */
export function endOfDayLabel(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  const day = new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", day: "numeric", month: "short" })
    .format(date)
    .replace(".", "");
  return `${day}, 23:59 (${APP_TIME_LABEL})`;
}
