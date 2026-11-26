import { describe, expect, it } from "vitest";
import {
  discordIdFromPlaceholderEmail,
  discordPlaceholderEmail,
  hasRole,
  resolveRole,
} from "./roles";

describe("resolveRole", () => {
  const ids = ["111111111111111111"];

  it("promueve a superadmin si el ID está en la lista", () => {
    expect(resolveRole("111111111111111111", "user", ids)).toBe("superadmin");
    expect(resolveRole("111111111111111111", "admin", ids)).toBe("superadmin");
  });

  it("mantiene el rol actual si no está en la lista (nunca degrada)", () => {
    expect(resolveRole("222", "user", ids)).toBe("user");
    expect(resolveRole("222", "admin", ids)).toBe("admin");
    expect(resolveRole("222", "superadmin", ids)).toBe("superadmin");
  });
});

describe("hasRole", () => {
  it("respeta la jerarquía superadmin > admin > user", () => {
    expect(hasRole("superadmin", "admin")).toBe(true);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("user", "admin")).toBe(false);
    expect(hasRole("admin", "superadmin")).toBe(false);
  });
});

describe("email placeholder de Discord", () => {
  it("ida y vuelta", () => {
    const id = "123456789012345678";
    expect(discordIdFromPlaceholderEmail(discordPlaceholderEmail(id))).toBe(id);
  });

  it("rechaza emails que no son placeholder", () => {
    expect(discordIdFromPlaceholderEmail("alguien@gmail.com")).toBeNull();
    expect(discordIdFromPlaceholderEmail("abc@discord.invalid")).toBeNull();
    expect(discordIdFromPlaceholderEmail("123456@discord.invalid.evil.com")).toBeNull();
  });
});
