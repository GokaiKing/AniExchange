import { describe, expect, it } from "vitest";
import { dayEndUtc } from "@/lib/dates";
import { assignmentMessage, drawInsufficientMessage, reminderMessage, revealMessage } from "./messages";

const base = {
  eventName: "Intercambio 2026",
  receiverName: "Goku_Fan",
  allowedTags: ["Action", "Isekai"],
  bannedTags: [],
  maxEpisodes: 26 as number | null,
  allowPtw: true,
  deadline: dayEndUtc("2026-12-15"),
  link: "https://ejemplo.test/assignment",
  redraw: false,
};

describe("assignmentMessage", () => {
  it("incluye lo que el giver necesita, con la zona y la hora local de Discord", () => {
    const text = assignmentMessage(base);
    expect(text).toContain("Te tocó darle un anime a **Goku\\_Fan**");
    expect(text).toContain("Géneros/tags preferidos: Action, Isekai");
    expect(text).toContain("No permitidos: ninguno");
    expect(text).toContain("Límite: 2 cours (hasta 26 episodios)");
    expect(assignmentMessage({ ...base, maxEpisodes: null })).toContain("Límite: Indefinido (sin límite)");
    expect(text).toContain("https://ejemplo.test/assignment");
    expect(text).toContain("15 dic, 23:59 (horario del vendehumo del admin)");
    expect(text).toMatch(/<t:\d+:f>/);
    expect(text.length).toBeLessThan(2000);
  });

  it("avisa cuando el sorteo se repitió", () => {
    expect(assignmentMessage({ ...base, redraw: true })).toMatch(/Se repitió el sorteo/);
  });
});

describe("otros mensajes", () => {
  it("recordatorio por fase", () => {
    const text = reminderMessage({
      eventName: "Intercambio 2026",
      phase: "selection",
      deadline: dayEndUtc("2026-12-19"),
      link: "https://ejemplo.test/assignment",
    });
    expect(text).toContain("elige la que vas a ver");
    expect(() =>
      reminderMessage({ eventName: "x", phase: "watching", deadline: new Date(), link: "" }),
    ).toThrow();
  });

  it("alerta de sorteo sin participantes suficientes", () => {
    expect(
      drawInsufficientMessage({ eventName: "E", participants: 2, minimum: 3, link: "https://x" }),
    ).toContain("solo hay 2 participantes");
  });
});

describe("revealMessage", () => {
  it("marca cuando no se terminó el anime, de ambos lados", () => {
    const text = revealMessage({
      eventName: "Intercambio",
      received: { title: "Toradora!", giverName: "Ana", finished: false },
      gave: { receiverName: "Beto", title: "Mob Psycho 100", rating: null, reviewed: false },
      link: "https://ejemplo.test/reveal",
    });
    expect(text).toContain("**Ana** te regaló *Toradora!* ❌ y no lo terminaste a tiempo.");
    expect(text).toContain("a **Beto** (❌ no lo terminó)");
  });

  it("sin marca cuando sí se terminó", () => {
    const text = revealMessage({
      eventName: "Intercambio",
      received: { title: "Toradora!", giverName: "Ana", finished: true },
      gave: { receiverName: "Beto", title: "Mob Psycho 100", rating: 8.5, reviewed: true },
      link: "https://ejemplo.test/reveal",
    });
    expect(text).not.toContain("❌");
    expect(text).toContain("le puso 8.5/10");
  });
});
