import { describe, expect, it } from "vitest";
import type { FetchFn } from "./anilist";
import { createDiscordSender, discordTimestamp, escapeMarkdown } from "./discord";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function fake(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error("sin más respuestas");
    if (next instanceof Error) throw next;
    return next;
  }) as FetchFn;
  return { fetchFn, calls };
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const sender = (fetchFn: FetchFn) =>
  createDiscordSender({ botToken: "tok", appBaseUrl: "https://ejemplo.test", fetchFn });

describe("createDiscordSender", () => {
  it("abre el DM y envía sin menciones", async () => {
    const { fetchFn, calls } = fake([json({ id: "chan-1" }), json({ id: "msg-1" })]);
    expect(await sender(fetchFn)("123", "hola")).toEqual({ ok: true });

    expect(calls[0].url).toBe("https://discord.com/api/v10/users/@me/channels");
    expect(calls[0].body).toEqual({ recipient_id: "123" });
    expect(calls[0].headers.authorization).toBe("Bot tok");
    expect(calls[0].headers["user-agent"]).toBe("DiscordBot (https://ejemplo.test, 1.0)");
    expect(calls[1].url).toBe("https://discord.com/api/v10/channels/chan-1/messages");
    expect(calls[1].body).toEqual({ content: "hola", allowed_mentions: { parse: [] } });
  });

  it("DMs cerrados → permanente", async () => {
    const { fetchFn } = fake([
      json({ id: "chan-1" }),
      json({ code: 50007, message: "Cannot send messages to this user" }, 403),
    ]);
    expect(await sender(fetchFn)("123", "hola")).toMatchObject({ ok: false, kind: "permanent" });
  });

  it("429 → rate_limited con retry_after", async () => {
    const { fetchFn } = fake([json({ message: "You are being rate limited.", retry_after: 1.5 }, 429)]);
    expect(await sender(fetchFn)("123", "hola")).toMatchObject({
      ok: false,
      kind: "rate_limited",
      retryAfterMs: 1500,
    });
  });

  it("5xx o red → transitorio", async () => {
    expect(await sender(fake([json({}, 502)]).fetchFn)("1", "x")).toMatchObject({ kind: "transient" });
    expect(await sender(fake([new TypeError("fetch failed")]).fetchFn)("1", "x")).toMatchObject({
      kind: "transient",
    });
  });

  it("recorta mensajes de más de 2000 caracteres", async () => {
    const { fetchFn, calls } = fake([json({ id: "c" }), json({ id: "m" })]);
    await sender(fetchFn)("1", "a".repeat(2500));
    expect((calls[1].body.content as string).length).toBe(2000);
  });
});

describe("helpers", () => {
  it("escapeMarkdown", () => {
    expect(escapeMarkdown("*Goku_Fan*")).toBe("\\*Goku\\_Fan\\*");
  });

  it("discordTimestamp", () => {
    expect(discordTimestamp(new Date("2026-12-11T06:59:59.999Z"))).toBe("<t:1796972399:f>");
  });
});
