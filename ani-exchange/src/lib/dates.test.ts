import { afterAll, describe, expect, it } from "vitest";
import {
  addDays,
  addYears,
  dayEndUtc,
  dayStartUtc,
  diffDays,
  formatAppDate,
  formatAppDateTime,
  isIsoDate,
  toAppDate,
} from "./dates";

// El resultado no debe depender de la zona del proceso (servidor o navegador).
// Node respeta cambios a process.env.TZ en caliente.
const ORIGINAL_TZ = process.env.TZ;
const ZONES = ["UTC", "America/Hermosillo", "Asia/Tokyo", "America/New_York", "Pacific/Kiritimati"];

afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

describe.each(ZONES)("con TZ=%s", (zone) => {
  it("convierte inicio y fin de día de Hermosillo a UTC", () => {
    process.env.TZ = zone;
    expect(dayStartUtc("2026-12-10").toISOString()).toBe("2026-12-10T07:00:00.000Z");
    expect(dayEndUtc("2026-12-10").toISOString()).toBe("2026-12-11T06:59:59.999Z");
  });

  it("no tiene horario de verano (julio igual que diciembre)", () => {
    process.env.TZ = zone;
    expect(dayStartUtc("2026-07-01").toISOString()).toBe("2026-07-01T07:00:00.000Z");
  });

  it("toAppDate es el inverso de dayStart/dayEnd", () => {
    process.env.TZ = zone;
    expect(toAppDate(dayStartUtc("2026-12-10"))).toBe("2026-12-10");
    expect(toAppDate(dayEndUtc("2026-12-10"))).toBe("2026-12-10");
    // 06:59 UTC del 11 sigue siendo 10 en Hermosillo
    expect(toAppDate(new Date(Date.UTC(2026, 11, 11, 6, 59)))).toBe("2026-12-10");
  });

  it("formatea en español con la zona explícita", () => {
    process.env.TZ = zone;
    expect(formatAppDateTime(dayEndUtc("2026-12-10"))).toBe(
      "10 dic, 23:59 (horario del vendehumo del admin)",
    );
    expect(formatAppDate(dayStartUtc("2026-12-10"))).toBe("10 dic 2026");
  });
});

describe("aritmética de días", () => {
  it("addDays cruza meses y años", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });

  it("addYears ajusta 29 de febrero", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
    expect(addYears("2026-12-10", 1)).toBe("2027-12-10");
  });

  it("diffDays", () => {
    expect(diffDays("2026-12-01", "2026-12-10")).toBe(9);
    expect(diffDays("2026-12-10", "2026-12-01")).toBe(-9);
  });
});

describe("validación", () => {
  it("isIsoDate", () => {
    expect(isIsoDate("2026-12-10")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-12-10T00:00")).toBe(false);
    expect(isIsoDate("10/12/2026")).toBe(false);
  });

  it("dayEndUtc rechaza fechas inválidas", () => {
    expect(() => dayEndUtc("2026-13-01")).toThrow();
  });
});
