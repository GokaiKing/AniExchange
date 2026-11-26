import { describe, expect, it } from "vitest";
import { type FetchFn, fetchTagCatalog } from "./anilist";

describe("fetchTagCatalog", () => {
  it("combina géneros y tags, sin contenido adulto ni duplicados", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({
          data: {
            GenreCollection: ["Action", "Hentai", "Romance"],
            MediaTagCollection: [
              { name: "Isekai", category: "Theme-Fantasy", isAdult: false },
              { name: "Nudity", category: "Sexual Content", isAdult: true },
              { name: "Action", category: "Dup", isAdult: false },
              { name: "4-koma", category: "Technical", isAdult: false },
            ],
          },
        }),
      )) as FetchFn;

    const catalog = await fetchTagCatalog(fetchFn);
    expect(catalog.filter((t) => t.category !== "Año de estreno")).toEqual([
      { name: "Action", category: "Género" },
      { name: "Romance", category: "Género" },
      { name: "4-koma", category: "Technical" },
      { name: "Isekai", category: "Theme-Fantasy" },
    ]);
    // Más los tags de año, que no existen en AniList.
    expect(catalog.map((t) => t.name)).toContain("Pre-2010");
  });

  it("falla con mensaje claro si AniList no responde datos", async () => {
    const fetchFn = (async () => new Response("oops", { status: 503 })) as FetchFn;
    await expect(fetchTagCatalog(fetchFn)).rejects.toThrow(/catálogo de tags/);
  });
});
