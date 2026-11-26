// /config's answer settings, and how an answer is shaped by them: the style rides with the chat so the reply is written
// that way, videos and follow-up suggestions are filtered from the post (never the report button), and every answer
// says what it checked and what it couldn't.
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { createHandler, type Lookups } from "./handler";
import { REPORT_PREFIX } from "./buttons";
import { DEFAULT_SETTINGS, styleLine } from "./settings";

const ok = (title: string): APIEmbed => ({ title });

function command(name: string, options: Record<string, string | number | boolean> = {}, user = "u1", guild = "g1") {
  const calls: { kind: string; payload?: any }[] = [];
  const i = {
    commandName: name,
    guildId: guild,
    channelId: "c1",
    user: { id: user, globalName: "Sam" },
    options: {
      data: Object.entries(options).map(([n, value]) => ({ name: n, value })),
      getInteger: (n: string) => options[n] as number,
      getString: (n: string) => options[n] as string | undefined,
      getBoolean: (n: string) => options[n] as boolean | undefined,
      getRole: () => null,
      getChannel: (n: string) => (options[n] == null ? null : { id: String(options[n]) }),
    },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isButton: () => false,
    reply: async (p: any) => { calls.push({ kind: "reply", payload: p }); },
    deferReply: async (p?: any) => { calls.push({ kind: "defer", payload: p }); },
    editReply: async (p: any) => { calls.push({ kind: "edit", payload: p }); },
  };
  return { i: i as any, calls };
}

function lookups(over: Partial<Lookups> = {}): Lookups {
  return {
    team: vi.fn(async (n: number) => ok(`team ${n}`)),
    next: vi.fn(async (n: number) => ok(`next ${n}`)),
    predict: vi.fn(async (e: string, n: number) => ok(`${e} ${n}`)),
    event: vi.fn(async (c: string) => ok(c)),
    rankings: vi.fn(async () => ok("rankings")),
    choices: vi.fn(async () => []),
    follow: vi.fn(async () => "added" as const),
    unfollow: vi.fn(async () => 1),
    following: vi.fn(async () => ok("following")),
    ask: vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false } })),
    config: vi.fn(async () => ok("What this bot can do here")),
    settings: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
    saveSettings: vi.fn(async () => {}),
    ...over,
  };
}

describe("/config: how this server's answers read", () => {
  it("shows the answer settings with the bot's setup, and saves one change at a time", async () => {
    const saveSettings = vi.fn(async () => {});
    const h = createHandler(() => {}, lookups({ saveSettings }));
    const shown = command("config");
    await h(shown.i);
    // Private, since it describes this bot's own setup rather than the channel's.
    expect(shown.calls[0].payload).toEqual({ flags: 64 });
    const field = shown.calls[1].payload.embeds[0].fields[0];
    expect(field.name).toBe("How answers read here");
    expect(field.value).toContain("**Style:** default");
    expect(field.value).toContain("**Videos:** on");

    // One option changes one thing; the other two are carried over rather than reset.
    const short = command("config", { style: "short", videos: false });
    await h(short.i);
    // Only the answers' settings travel: quiet hours and the ping role belong to /settings and are never rewritten here.
    expect(saveSettings).toHaveBeenCalledWith("g1", { style: "short", videos: false, extras: true, askChannel: null }, "u1");
    expect(short.calls[1].payload.embeds[0].description).toContain("**Saved.**");
    expect(short.calls[1].payload.embeds[0].description).toContain("`short`");

    // A style it can't read is refused, and nothing is saved.
    const bad = command("config", { style: "huge" });
    await h(bad.i);
    expect(bad.calls[1].payload.embeds[0].title).toBe("Answer style?");
    expect(saveSettings).toHaveBeenCalledTimes(1);

    // reset puts all three back, and only this server's row changes.
    const reset = command("config", { reset: true });
    await h(reset.i);
    expect(saveSettings).toHaveBeenLastCalledWith("g1", { style: "default", extras: true, videos: true, askChannel: null }, "u1");
  });

  it("channel: answers plain messages there with no mention, each in a thread; reset takes it away", async () => {
    const saveSettings = vi.fn(async () => {});
    const h = createHandler(() => {}, lookups({ saveSettings }));
    const pick = command("config", { channel: "111111111111111111" });
    await h(pick.i);
    expect(saveSettings).toHaveBeenCalledWith("g1", { style: "default", extras: true, videos: true, askChannel: "111111111111111111" }, "u1");
    const embed = pick.calls[1].payload.embeds[0];
    expect(embed.fields[0].value).toContain("**Questions without a mention:** in <#111111111111111111>");
    expect(embed.fields[0].value).toContain("in its own thread");
    expect(embed.description).toContain("each in its own thread");
    // reset is how a server stops answering without a mention, along with the other answer settings.
    const reset = command("config", { reset: true });
    await h(reset.i);
    expect(saveSettings).toHaveBeenLastCalledWith("g1", { style: "default", extras: true, videos: true, askChannel: null }, "u1");
  });

  it("a failed settings read refuses the change rather than writing defaults over the row", async () => {
    const settings = vi.fn(async () => { throw new Error("database busy"); });
    const saveSettings = vi.fn(async () => {});
    const h = createHandler(() => {}, lookups({ settings, saveSettings }));
    const change = command("config", { style: "detailed" });
    await h(change.i);
    expect(change.calls[1].payload.embeds[0].title).toBe("Couldn't read the settings");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("the server's style rides with the chat, so the reply is written that way", async () => {
    const ask = vi.fn(async (q: string) => ({ embed: ok(q), meta: { step: "deterministic" as const, refined: false, sentence: false } }));
    const settings = vi.fn(async () => ({ ...DEFAULT_SETTINGS, style: "short" as const }));
    const h = createHandler(() => {}, lookups({ ask, settings }));
    await h(command("ask", { question: "who won decode" }).i);
    // ask(question, history, memory, …): the style line is in the chat's memory, so it is part of the cache key too.
    expect((ask.mock.calls[0] as unknown[])[2]).toContain(styleLine({ ...DEFAULT_SETTINGS, style: "short" }));
  });

  it("videos:false drops the clips and their links, extras:false the next questions, and the report button stays", async () => {
    const ask = vi.fn(async (q: string) => ({
      embed: ok("4215"),
      meta: { step: "deterministic" as const, refined: false, sentence: false },
      content: "https://www.youtube.com/watch?v=AAA",
      watch: [{ label: "Q1", url: "https://www.youtube.com/watch?v=AAA" }],
      next: ["4215 opr"],
      checked: { searches: 2, unanswered: ["videos"] },
    }));
    const settings = vi.fn(async () => ({ ...DEFAULT_SETTINGS, videos: false, extras: false }));
    const { i, calls } = command("ask", { question: "4215 videos" });
    await createHandler(() => {}, lookups({ ask, settings }))(i);
    const post = calls[1].payload;
    // The clip was the message's only text, so the answer is the card alone.
    expect(post.content).toBeUndefined();
    expect(JSON.stringify(post.components ?? [])).not.toContain("4215 opr");
    expect(JSON.stringify(post.components ?? [])).toContain(REPORT_PREFIX);
    // The check line says what the answer checked. It does not blame a failed lookup for videos: this server turned
    // them off, which is a choice, not a miss.
    expect(post.embeds[0].footer.text).toContain("✓ Checked 2 searches");
    expect(post.embeds[0].footer.text).not.toContain("couldn't check");
  });

  it("a chat answer with a card carries the check line once, in its text", async () => {
    const ask = vi.fn(async (q: string) => ({
      embed: ok("4215"),
      meta: { step: "deterministic" as const, refined: false, sentence: false },
      chat: { text: "4215 is from Hillsborough, NJ.", card: true },
      checked: { searches: 2, unanswered: [] },
    }));
    const h = createHandler(() => {}, lookups({ ask }));
    const { i, calls } = command("ask", { question: "where is 4215 from" });
    await h(i);
    const post = calls[1].payload;
    expect(post.content).toContain("✓ Checked 2 searches");
    // The card rides beside the words; it must not repeat the same line in its footer.
    expect(post.embeds[0].footer?.text ?? "").not.toContain("Checked");
  });

  it("an answer with clips keeps them, and its footer says what it checked", async () => {
    const ask = vi.fn(async (q: string) => ({
      embed: ok("4215"),
      meta: { step: "deterministic" as const, refined: false, sentence: false },
      watch: [{ label: "Q1", url: "https://www.youtube.com/watch?v=AAA" }],
      next: ["4215 opr"],
      checked: { searches: 1, unanswered: ["who won decode"] },
    }));
    const h = createHandler(() => {}, lookups({ ask }));
    const { i, calls } = command("ask", { question: "4215 highlights" });
    await h(i);
    const post = calls[1].payload;
    expect(post.embeds[0].footer.text).toContain("✓ Checked 1 search");
    expect(post.embeds[0].footer.text).toContain("couldn't check: who won decode");
    expect(JSON.stringify(post.components)).toContain("youtube.com");
  });
});
