import { describe, expect, it } from "vitest";
import { normalizeTag, resolveTag, searchTags } from "./tag-aliases";

const names = ["Boys' Love", "Yuri", "LGBTQ+ Themes", "Sci-Fi", "Slice of Life", "Action", "Shounen", "Shoujo", "Space", "Time Skip"];

describe("resolveTag", () => {
  it.each([
    ["Boys' Love", "Boys' Love"],
    ["Boy's Love", "Boys' Love"],
    ["boys love", "Boys' Love"],
    ["BL", "Boys' Love"],
    ["yaoi", "Boys' Love"],
    ["Shounen Ai", "Boys' Love"],
    ["yuri", "Yuri"],
    ["GL", "Yuri"],
    ["Girls' Love", "Yuri"],
    ["Girl's Love", "Yuri"],
    ["Shoujo-ai", "Yuri"],
    ["lgbtq+", "LGBTQ+ Themes"],
    ["scifi", "Sci-Fi"],
    ["SoL", "Slice of Life"],
    ["  ACTION ", "Action"],
    // Variantes simétricas y en español
    ["Bara", "Boys' Love"],
    ["chico x chico", "Boys' Love"],
    ["ChicoxChico", "Boys' Love"],
    ["BxB", "Boys' Love"],
    ["amor entre hombres", "Boys' Love"],
    ["gay", "Boys' Love"],
    ["chica x chica", "Yuri"],
    ["GxG", "Yuri"],
    ["amor entre mujeres", "Yuri"],
    ["Lésbico", "Yuri"],
    ["lesbianas", "Yuri"],
  ])("%j → %s", (input, expected) => {
    expect(resolveTag(input, names)).toBe(expected);
  });

  it("no inventa tags", () => {
    expect(resolveTag("Hentai", names)).toBeNull();
    expect(resolveTag("", names)).toBeNull();
    // alias cuyo destino no está en el catálogo
    expect(resolveTag("BL", ["Action"])).toBeNull();
  });

  it("normalizeTag", () => {
    expect(normalizeTag("Boy's  Love")).toBe("boyslove");
    expect(normalizeTag("Mahō Shōjo")).toBe("mahoshojo");
  });
});

describe("searchTags", () => {
  it("encuentra por fragmento, con o sin la u de AniList", () => {
    expect(searchTags("shon", names)).toContain("Shounen");
    expect(searchTags("shonen", names)[0]).toBe("Shounen"); // luego Boys' Love ("shonen ai")
    expect(searchTags("shounen", names)[0]).toBe("Shounen");
    expect(searchTags("shojo", names)[0]).toBe("Shoujo");
  });

  it("primero los que empiezan con el texto, luego los que lo contienen", () => {
    expect(searchTags("s", names).slice(0, 3)).toEqual(["Sci-Fi", "Slice of Life", "Shounen"]);
    expect(searchTags("skip", names)).toEqual(["Time Skip"]);
  });

  it("sugiere el tag oficial a partir de alias", () => {
    expect(searchTags("yao", names)).toEqual(["Boys' Love"]);
    expect(searchTags("chica", names)).toEqual(["Yuri"]);
    expect(searchTags("", names)).toEqual([]);
  });
});
