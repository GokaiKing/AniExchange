import { describe, expect, it } from "vitest";
import { parseAnimeLink, type Media } from "@/lib/anime";
import { checkMedia, listWarnings, missesPreferred, type ReceiverRules } from "./proposal-rules";

const bebop: Media = {
  id: 1,
  idMal: 1,
  title: "Cowboy Bebop",
  format: "TV",
  status: "FINISHED",
  episodes: 26,
  duration: 24,
  isAdult: false,
  genres: ["Action", "Sci-Fi"],
  tags: [
    { name: "Space", rank: 94 },
    { name: "Gore", rank: 15 },
  ],
  coverUrl: null,
  siteUrl: "https://anilist.co/anime/1",
};

const rules: ReceiverRules = { maxEpisodes: 26, bannedTags: [], allowPtw: true };
const errors = (patch: Partial<Media>, r: Partial<ReceiverRules> = {}) =>
  checkMedia({ ...bebop, ...patch }, { ...rules, ...r }).errors;

describe("checkMedia", () => {
  it("acepta un anime que cumple todo", () => {
    expect(checkMedia(bebop, rules)).toEqual({ errors: [], warnings: [] });
  });

  it("solo TV u ONA", () => {
    expect(errors({ format: "ONA" })).toEqual([]);
    expect(errors({ format: "MOVIE" })[0]).toMatch(/película/);
    expect(errors({ format: "TV_SHORT" })[0]).toMatch(/TV corta/);
    expect(errors({ format: "OVA" })).toHaveLength(1);
  });

  it("solo terminados", () => {
    expect(errors({ status: "RELEASING" })[0]).toMatch(/termina/);
    expect(errors({ status: "NOT_YET_RELEASED" })).toHaveLength(1);
  });

  it("entre 10 episodios y el límite del receptor", () => {
    expect(errors({ episodes: 9 })[0]).toMatch(/mínimo es 10/);
    expect(errors({ episodes: 10 })).toEqual([]);
    expect(errors({ episodes: 27 })[0]).toMatch(/límite es 26/);
    expect(errors({ episodes: null })[0]).toMatch(/cuántos episodios/);
    expect(errors({ episodes: 64 }, { maxEpisodes: null })).toEqual([]); // indefinido
  });

  it("episodios de al menos 20 minutos", () => {
    expect(errors({ duration: 20 })).toEqual([]);
    expect(errors({ duration: 12 })[0]).toMatch(/12 min/);
    expect(errors({ duration: null })).toHaveLength(1);
  });

  it("sin contenido adulto", () => {
    expect(errors({ isAdult: true })[0]).toMatch(/adultos/);
  });

  it("géneros baneados bloquean; tags según relevancia", () => {
    expect(errors({}, { bannedTags: ["Sci-Fi"] })[0]).toMatch(/género baneado "Sci-Fi"/);
    expect(errors({}, { bannedTags: ["Space"] })[0]).toMatch(/tag baneado "Space" \(94%\)/);
    const lowRank = checkMedia(bebop, { ...rules, bannedTags: ["Gore"] });
    expect(lowRank.errors).toEqual([]);
    expect(lowRank.warnings[0]).toMatch(/un poco del tag baneado "Gore" \(15%\)/);
  });
});

describe("listWarnings", () => {
  it("avisa si ya lo vio, lo ve, lo dropeó o lo pausó", () => {
    expect(listWarnings("completed", rules)).toEqual(["Ya lo vio"]);
    expect(listWarnings("dropped", rules)).toEqual(["Lo dropeó"]);
    expect(listWarnings("watching", rules)).toEqual(["Lo está viendo"]);
    expect(listWarnings(null, rules)).toEqual([]);
  });

  it("Plan to Watch: solo avisa si el receptor no lo aceptó", () => {
    expect(listWarnings("planning", rules)).toEqual([]);
    expect(listWarnings("planning", { ...rules, allowPtw: false })[0]).toMatch(/pidió no recibir/);
  });
});

describe("parseAnimeLink", () => {
  it.each([
    ["https://anilist.co/anime/1/Cowboy-Bebop/", { source: "anilist", id: 1 }],
    ["anilist.co/anime/21", { source: "anilist", id: 21 }],
    ["https://myanimelist.net/anime/1/Cowboy_Bebop", { source: "mal", id: 1 }],
    ["https://www.myanimelist.net/anime/5114", { source: "mal", id: 5114 }],
  ])("%s", (input, expected) => {
    expect(parseAnimeLink(input)).toEqual(expected);
  });

  it.each(["", "Cowboy Bebop", "https://anilist.co/manga/30013", "https://example.com/anime/1", "https://anilist.co/anime/abc"])(
    "rechaza %j",
    (input) => {
      expect(parseAnimeLink(input)).toBeNull();
    },
  );
});

describe("missesPreferred", () => {
  it("sin preferidos marcados nunca avisa", () => {
    expect(missesPreferred(bebop, [])).toBe(false);
  });

  it("cuenta géneros siempre y tags desde 40% de relevancia", () => {
    expect(missesPreferred(bebop, ["Sci-Fi"])).toBe(false); // género
    expect(missesPreferred(bebop, ["Space"])).toBe(false); // tag 94%
    expect(missesPreferred(bebop, ["Gore"])).toBe(true); // tag 15%: no cuenta
    expect(missesPreferred(bebop, ["Romance", "Isekai"])).toBe(true);
    expect(missesPreferred(bebop, ["Romance", "Action"])).toBe(false); // basta uno
  });
});
