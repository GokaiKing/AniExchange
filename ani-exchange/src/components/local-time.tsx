"use client";

import { useSyncExternalStore } from "react";

const APP_TIMEZONE = "America/Hermosillo";

const format = (date: Date, timeZone?: string) =>
  new Intl.DateTimeFormat("es-MX", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(date)
    .replace(".", "");

/** Hora local del navegador, o null si coincide con la de Hermosillo. */
function localLabel(iso: string): string | null {
  const date = new Date(iso);
  const local = format(date);
  return local === format(date, APP_TIMEZONE) ? null : local;
}

const noopSubscribe = () => () => {};

/**
 * Referencia secundaria: "· tu hora: 9 dic, 03:59". Solo se calcula en el
 * navegador (en el servidor no hay zona del usuario), así que no causa
 * desajustes de hidratación.
 */
export function LocalTime({ iso, className }: { iso: string; className?: string }) {
  const label = useSyncExternalStore(
    noopSubscribe,
    () => localLabel(iso),
    () => null,
  );
  if (!label) return null;
  return <span className={className ?? "text-muted-foreground"}> · tu hora: {label}</span>;
}
