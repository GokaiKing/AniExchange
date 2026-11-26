/**
 * Único punto de conversión de fechas de la app (spec §5).
 *
 * - En la base todo es UTC (`timestamptz`).
 * - El panel trabaja solo con días ("2026-12-10"), interpretados en
 *   America/Hermosillo (UTC-7 todo el año, sin horario de verano).
 * - Un día empieza a las 00:00:00.000 y termina a las 23:59:59.999 hora de
 *   Hermosillo.
 *
 * No usar `new Date("…")` con strings en ningún otro lugar.
 */
import { DateTime } from "luxon";

export const APP_TIMEZONE = "America/Hermosillo";
const LOCALE = "es-MX";

/** Fecha de calendario en formato ISO, p. ej. "2026-12-10". */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO_DATE.test(value) && DateTime.fromISO(value, { zone: APP_TIMEZONE }).isValid;
}

function parseDay(isoDate: IsoDate): DateTime {
  if (!ISO_DATE.test(isoDate)) throw new Error(`Fecha inválida: "${isoDate}"`);
  const day = DateTime.fromISO(isoDate, { zone: APP_TIMEZONE });
  if (!day.isValid) throw new Error(`Fecha inválida: "${isoDate}"`);
  return day;
}

function inApp(utc: Date): DateTime {
  return DateTime.fromJSDate(utc, { zone: APP_TIMEZONE });
}

/** 00:00:00.000 del día en Hermosillo, como instante UTC. */
export function dayStartUtc(isoDate: IsoDate): Date {
  return parseDay(isoDate).startOf("day").toJSDate();
}

/** 23:59:59.999 del día en Hermosillo, como instante UTC. */
export function dayEndUtc(isoDate: IsoDate): Date {
  return parseDay(isoDate).endOf("day").toJSDate();
}

/** Día de calendario (en Hermosillo) al que pertenece un instante UTC. */
export function toAppDate(utc: Date): IsoDate {
  return inApp(utc).toISODate()!;
}

/** Hoy en Hermosillo. */
export function todayAppDate(now: Date = new Date()): IsoDate {
  return toAppDate(now);
}

/** Suma días de calendario a una fecha ISO. */
export function addDays(isoDate: IsoDate, days: number): IsoDate {
  return parseDay(isoDate).plus({ days }).toISODate()!;
}

/** Suma años de calendario a una fecha ISO (29 feb → 28 feb si no es bisiesto). */
export function addYears(isoDate: IsoDate, years: number): IsoDate {
  return parseDay(isoDate).plus({ years }).toISODate()!;
}

/** Diferencia en días de calendario: b - a. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round(parseDay(b).diff(parseDay(a), "days").days);
}

/** "10 dic 2026" */
export function formatAppDate(utc: Date): string {
  return inApp(utc).setLocale(LOCALE).toFormat("d LLL yyyy").replace(".", "");
}

/** "10 dic, 23:59 hora de Hermosillo" */
export function formatAppDateTime(utc: Date): string {
  const text = inApp(utc).setLocale(LOCALE).toFormat("d LLL, HH:mm").replace(".", "");
  return `${text} hora de Hermosillo`;
}
