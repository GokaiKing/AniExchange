import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

const secret = "s3cr3t-de-prueba-largo";

describe("isCronAuthorized", () => {
  it("acepta el Bearer correcto", () => {
    expect(isCronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
  });

  it.each([null, "", secret, `Bearer ${secret}x`, `bearer ${secret}`, "Bearer ", `Basic ${secret}`])(
    "rechaza %j",
    (header) => {
      expect(isCronAuthorized(header, secret)).toBe(false);
    },
  );

  it("rechaza todo si no hay secreto configurado o es muy corto", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer corto", "corto")).toBe(false);
  });
});
