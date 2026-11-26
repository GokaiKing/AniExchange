import { describe, expect, it } from "vitest";
import type { FetchFn } from "./anilist";
import { malUsernameFromProfileHtml, parseProfileInput, verifyProfile } from "./profiles";

describe("parseProfileInput", () => {
  it.each([
    ["anilist", "https://anilist.co/user/GokuFan/", { kind: "name", value: "GokuFan" }],
    ["anilist", "anilist.co/user/GokuFan/animelist", { kind: "name", value: "GokuFan" }],
    ["anilist", "https://anilist.co/user/5810535", { kind: "id", value: 5810535 }],
    ["anilist", "GokuFan", { kind: "name", value: "GokuFan" }],
    ["mal", "https://myanimelist.net/profile/Xinil", { kind: "name", value: "Xinil" }],
    ["mal", "https://myanimelist.net/animelist/Xinil?status=2", { kind: "name", value: "Xinil" }],
    ["mal", "www.myanimelist.net/profile/some_user-1", { kind: "name", value: "some_user-1" }],
    ["mal", "  Xinil  ", { kind: "name", value: "Xinil" }],
  ] as const)("%s: %s", (platform, input, expected) => {
    expect(parseProfileInput(platform, input)).toEqual({
      ok: true,
      ref: { platform, ...expected },
    });
  });

  it("detecta un link de la otra plataforma", () => {
    const result = parseProfileInput("mal", "https://anilist.co/user/GokuFan");
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/AniList/) });
  });

  it.each([
    ["anilist", ""],
    ["anilist", "https://example.com/user/x"],
    ["anilist", "https://anilist.co/anime/1/Cowboy-Bebop"],
    ["mal", "https://myanimelist.net/anime/1/Cowboy_Bebop"],
    ["mal", "nombre con espacios"],
    ["mal", "<script>"],
  ] as const)("rechaza %s: %j", (platform, input) => {
    expect(parseProfileInput(platform, input).ok).toBe(false);
  });
});

describe("malUsernameFromProfileHtml", () => {
  it("toma el nombre canónico del título", () => {
    expect(malUsernameFromProfileHtml("<title>\n  Xinil&#039;s Profile - MyAnimeList.net\n</title>")).toBe(
      "Xinil",
    );
    expect(malUsernameFromProfileHtml("<title>nada</title>")).toBeNull();
  });
});

/** fetch falso: responde según la URL / el cuerpo GraphQL. */
function fakeFetch(handler: (url: string, body: string) => Response | Promise<Response>): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), typeof init?.body === "string" ? init.body : "")) as FetchFn;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

describe("verifyProfile — AniList", () => {
  const ref = { platform: "anilist", kind: "name", value: "gokufan" } as const;

  it("ok con nombre canónico", async () => {
    const fetchFn = fakeFetch((_, body) =>
      body.includes("User(")
        ? json({ data: { User: { id: 7, name: "GokuFan" } } })
        : json({ data: { MediaListCollection: { user: { id: 7 } } } }),
    );
    expect(await verifyProfile(ref, fetchFn)).toEqual({
      ok: true,
      username: "GokuFan",
      profileUrl: "https://anilist.co/user/GokuFan/",
    });
  });

  it("no existe", async () => {
    const fetchFn = fakeFetch(() =>
      json({ data: { User: null }, errors: [{ message: "Not Found.", status: 404 }] }, 404),
    );
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("lista privada", async () => {
    const fetchFn = fakeFetch((_, body) =>
      body.includes("User(")
        ? json({ data: { User: { id: 7, name: "GokuFan" } } })
        : json({ data: { MediaListCollection: null }, errors: [{ message: "Private User", status: 404 }] }),
    );
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "private" });
  });

  it("servicio caído", async () => {
    const fetchFn = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "unavailable" });
    const rateLimited = fakeFetch(() => json({ errors: [{ message: "Too Many Requests", status: 429 }] }, 429));
    expect(await verifyProfile(ref, rateLimited)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});

describe("verifyProfile — MAL", () => {
  const ref = { platform: "mal", kind: "name", value: "xinil" } as const;
  const profileHtml = "<title> Xinil&#039;s Profile - MyAnimeList.net </title>";

  it("ok con nombre canónico", async () => {
    const fetchFn = fakeFetch((url) =>
      url.includes("/profile/") ? new Response(profileHtml) : json([]),
    );
    expect(await verifyProfile(ref, fetchFn)).toEqual({
      ok: true,
      username: "Xinil",
      profileUrl: "https://myanimelist.net/profile/Xinil",
    });
  });

  it("no existe", async () => {
    const fetchFn = fakeFetch(() => new Response("not found", { status: 404 }));
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("lista privada", async () => {
    const fetchFn = fakeFetch((url) =>
      url.includes("/profile/")
        ? new Response(profileHtml)
        : json({ errors: [{ message: "invalid request" }] }, 400),
    );
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "private" });
  });

  it("servicio caído", async () => {
    const fetchFn = fakeFetch(() => new Response("bad gateway", { status: 502 }));
    expect(await verifyProfile(ref, fetchFn)).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
