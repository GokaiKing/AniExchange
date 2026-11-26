/**
 * Texto de los DMs. Funciones puras.
 *
 * Anonimato (spec §7.1): los mensajes al receptor nunca mencionan al giver; los
 * del giver solo mencionan el nombre público del receptor.
 */
import type { PhaseKey } from "@/db/schema";
import { formatAppDateTime } from "@/lib/dates";
import { discordTimestamp, escapeMarkdown } from "@/lib/discord";
import { episodeLimitLabel } from "@/lib/registration";

function deadlineLine(deadline: Date): string {
  return `${formatAppDateTime(deadline)} · en tu hora: ${discordTimestamp(deadline)}`;
}

const list = (items: string[]) =>
  items.length > 0 ? items.map(escapeMarkdown).join(", ") : "ninguno";

export type AssignmentMessageInput = {
  eventName: string;
  receiverName: string;
  allowedTags: string[];
  bannedTags: string[];
  maxEpisodes: number | null;
  allowPtw: boolean;
  /** Cierre de la fase de propuestas. */
  deadline: Date | null;
  link: string;
  /** El sorteo se repitió: este mensaje reemplaza al anterior. */
  redraw: boolean;
  /** Se reasignó porque alguien salió del ciclo. */
  reassigned?: boolean;
};

export function assignmentMessage(input: AssignmentMessageInput): string {
  const lines = [
    input.reassigned
      ? `⚠️ **Cambio en ${escapeMarkdown(input.eventName)}:** tu receptor anterior salió del intercambio, así que ahora le das a otra persona. Lo que habías propuesto ya no cuenta.`
      : input.redraw
        ? `⚠️ **Se repitió el sorteo de ${escapeMarkdown(input.eventName)}.** Ignora el mensaje anterior: esta es tu asignación vigente.`
        : `🎁 **${escapeMarkdown(input.eventName)}**`,
    "",
    `Te tocó darle un anime a **${escapeMarkdown(input.receiverName)}**.`,
    `• Géneros/tags preferidos: ${list(input.allowedTags)}`,
    `• No permitidos: ${list(input.bannedTags)}`,
    `• Límite: ${episodeLimitLabel(input.maxEpisodes)}`,
    `• Plan to Watch: ${input.allowPtw ? "acepta animes de su lista" : "no quiere animes de su lista"}`,
    "",
    `Propón hasta 3 opciones aquí: ${input.link}`,
  ];
  if (input.deadline) lines.push(`Fecha límite: ${deadlineLine(input.deadline)}`);
  lines.push("", "🤫 Es secreto: no le digas a nadie a quién te tocó.");
  return lines.join("\n");
}

const REMINDER_TEXT: Partial<Record<PhaseKey, string>> = {
  proposals: "todavía no has propuesto animes para tu intercambio",
  selection: "ya tienes propuestas esperando: elige la que vas a ver",
  evidence: "¿ya terminaste tu anime? Falta subir tu review",
};

export function hasReminderText(phase: PhaseKey): boolean {
  return phase in REMINDER_TEXT;
}

export function reminderMessage(input: {
  eventName: string;
  phase: PhaseKey;
  deadline: Date;
  link: string;
}): string {
  const text = REMINDER_TEXT[input.phase];
  if (!text) throw new Error(`La fase ${input.phase} no tiene recordatorio`);
  return [
    `⏰ **${escapeMarkdown(input.eventName)}**: ${text}.`,
    `Cierra: ${deadlineLine(input.deadline)}`,
    input.link,
  ].join("\n");
}

export function revealMessage(input: {
  eventName: string;
  /** Lo que recibió: anime, quién se lo dio y si subió su review a tiempo. */
  received: { title: string; giverName: string; finished: boolean } | null;
  /** Lo que dio: a quién, qué anime y cómo le fue. */
  gave: { receiverName: string; title: string | null; rating: number | null; reviewed: boolean } | null;
  link: string;
}): string {
  const lines = [`🎉 **Reveal de ${escapeMarkdown(input.eventName)}**`, ""];
  if (input.received) {
    lines.push(
      `🎁 **${escapeMarkdown(input.received.giverName)}** te regaló *${escapeMarkdown(input.received.title)}*` +
        (input.received.finished ? "." : " ❌ y no lo terminaste a tiempo."),
    );
  }
  if (input.gave) {
    const anime = input.gave.title ? ` *${escapeMarkdown(input.gave.title)}*` : "";
    const outcome = !input.gave.reviewed
      ? "❌ no lo terminó"
      : input.gave.rating !== null
        ? `le puso ${input.gave.rating}/10`
        : "ya dejó su review";
    lines.push(`🎄 Tú le diste${anime} a **${escapeMarkdown(input.gave.receiverName)}** (${outcome}).`);
  }
  lines.push("", `Mira todos los pares: ${input.link}`);
  return lines.join("\n");
}

const ON_MISS_TEXT: Record<string, string> = {
  random_from_ptw: "no se pudo proponer automáticamente desde su Plan to Watch; quedaron como no participó",
  reassign: "quedaron como no participó y sus receptores necesitan reasignación manual",
  mark_no_show: "quedaron como no participó",
};

export function onMissAlertMessage(input: {
  eventName: string;
  phaseLabel: string;
  policy: string;
  count: number;
  link: string;
}): string {
  const who = input.count === 1 ? "1 participante no cumplió" : `${input.count} participantes no cumplieron`;
  return [
    `⚠️ **${escapeMarkdown(input.eventName)}**: al cerrar ${input.phaseLabel}, ${who}; ${ON_MISS_TEXT[input.policy] ?? input.policy}.`,
    "Revisa el panel:",
    input.link,
  ].join("\n");
}

export function drawInsufficientMessage(input: {
  eventName: string;
  participants: number;
  minimum: number;
  link: string;
}): string {
  return [
    `⚠️ **${escapeMarkdown(input.eventName)}**: el sorteo no se ejecutó porque solo hay ${input.participants} participantes activos (mínimo ${input.minimum}).`,
    "La edición quedó en pausa. Extiende la inscripción y reanúdala desde el panel:",
    input.link,
  ].join("\n");
}
