import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://u@localhost:5432/db",
  AUTH_SECRET: "x".repeat(32),
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
};

describe("parseEnv", () => {
  it("parsea SUPERADMIN_DISCORD_IDS como lista, ignorando espacios y vacíos", () => {
    const env = parseEnv({ ...base, SUPERADMIN_DISCORD_IDS: " 123 , 456,,789 " });
    expect(env.SUPERADMIN_DISCORD_IDS).toEqual(["123", "456", "789"]);
  });

  it("lista vacía si no hay superadmins", () => {
    expect(parseEnv(base).SUPERADMIN_DISCORD_IDS).toEqual([]);
  });

  it("aplica los defaults de zona horaria y URL", () => {
    const env = parseEnv(base);
    expect(env.APP_TIMEZONE).toBe("America/Hermosillo");
    expect(env.APP_BASE_URL).toBe("http://localhost:3000");
  });

  it("falla con un mensaje claro si falta algo", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => parseEnv({ ...base, AUTH_SECRET: "corto" })).toThrow(/AUTH_SECRET/);
  });

  it("rechaza otra zona horaria", () => {
    expect(() => parseEnv({ ...base, APP_TIMEZONE: "America/Mexico_City" })).toThrow();
  });
});
