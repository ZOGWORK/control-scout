// The interaction handler with stand-in interactions: deferred replies, the shared cache, no per-person pace, and
// friendly errors for every failure (never the exception's words).
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { createHandler, type Lookups, type MentionMessage } from "./handler";
import { Friendly } from "./views";
import { AnswerCache } from "./guard";
import { COMMANDS, sameCommands } from "./commands";
import { BOT_COMMANDS } from "../src/shared/discord";

function command(name: string, options: Record<string, string | number>, user = "u1") {
  const calls: { kind: string; payload?: any }[] = [];
  const i = {
    commandName: name,
    user: { id: user },
    options: {
      data: Object.entries(options).map(([n, value]) => ({ name: n, value })),
      getInteger: (n: string) => options[n] as number,
      getString: (n: string) => options[n] as string,
    },
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    reply: async (payload: any) => { calls.push({ kind: "reply", payload }); },
    deferReply: async () => { calls.push({ kind: "defer" }); },
    editReply: async (payload: any) => { calls.push({ kind: "edit", payload }); },
  };
  return { i: i as any, calls };
}

const ok = (title: string): APIEmbed => ({ title });
function lookups(over: Partial<Lookups> = {}): Lookups {
  return {
    team: vi.fn(async (n: number) => ok(`team ${n}`)),
    predict: vi.fn(async (e: string, n: number) => ok(`${e} ${n}`)),
    event: vi.fn(async (c: string) => ok(c)),
    rankings: vi.fn(async () => ok("rankings")),
    choices: vi.fn(async () => [{ name: "A (A)", value: "A" }]),
    follow: vi.fn(async () => "added" as const),
    unfollow: vi.fn(async () => 1),
    following: vi.fn(async () => ok("following")),
    ask: vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false } })),
    ...over,
  };
}

describe("commands", () => {
  it("defers, then answers with the lookup's embed", async () => {
    const h = createHandler(() => {}, lookups());
    const { i, calls } = command("team", { number: 18360 });
    await h(i);
    expect(calls.map((c) => c.kind)).toEqual(["defer", "edit"]);
    expect(calls[1].payload.embeds[0].title).toBe("team 18360");
  });

  it("the same command and arguments within a minute cost one lookup, whoever asks", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    await Promise.all(["a", "b", "c"].map((u) => h(command("predict", { event: "ustxauq", match: 3 }, u).i)));
    await h(command("predict", { event: "USTXAUQ", match: 3 }, "d").i);
    expect(l.predict).toHaveBeenCalledTimes(1);
  });

  it("turned off by the owner (the discordBot toggle): every command gets a private note, and nothing is looked up or followed", async () => {
    const l = lookups({ enabled: async (f) => f !== "discordBot" });
    const h = createHandler(() => {}, l);
    for (const [name, opts] of [["team", { number: 1 }], ["predict", { event: "X", match: 1 }], ["follow", { team: 1 }], ["help", {}]] as [string, Record<string, string | number>][]) {
      const { i, calls } = command(name, opts);
      await h(i);
      expect(calls).toHaveLength(1);
      expect(calls[0].kind).toBe("reply");
      expect(calls[0].payload.embeds[0].title).toBe("Turned off for now");
      expect(calls[0].payload.embeds[0].description).toMatch(/turned off by the owner/);
      expect(calls[0].payload.flags).toBe(64); // ephemeral
    }
    expect(l.team).not.toHaveBeenCalled();
    expect(l.predict).not.toHaveBeenCalled();
    expect(l.follow).not.toHaveBeenCalled();
    // Autocomplete answers nothing either.
    const sent: unknown[] = [];
    await h({ commandName: "predict", isChatInputCommand: () => false, isAutocomplete: () => true, options: { getFocused: () => "a" }, respond: async (x: unknown) => { sent.push(x); } } as any);
    expect(sent).toEqual([[]]);
    expect(l.choices).not.toHaveBeenCalled();
  });

  it("live predictions switched off: /predict says so, the other commands still answer", async () => {
    const l = lookups({ enabled: async (f) => f !== "livePredictions" });
    const h = createHandler(() => {}, l);
    const p = command("predict", { event: "X", match: 1 });
    await h(p.i);
    expect(p.calls[1].payload.embeds[0].title).toBe("Predictions are off");
    expect(l.predict).not.toHaveBeenCalled();
    const t = command("team", { number: 1 });
    await h(t.i);
    expect(t.calls[1].payload.embeds[0].title).toBe("team 1");
  });

  it("no per-person pace: two commands in a row from one person both answer", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    await h(command("team", { number: 1 }).i);
    const { i, calls } = command("team", { number: 2 });
    await h(i);
    expect(calls.map((c) => c.kind)).toEqual(["defer", "edit"]);
    expect(calls[1].payload.embeds[0].title).toBe("team 2");
    expect(l.team).toHaveBeenCalledTimes(2);
  });

  it("a friendly error is shown as is and not logged", async () => {
    const log = vi.fn();
    const h = createHandler(log, lookups({ team: async () => { throw new Friendly("Team not found", "No team 9."); } }));
    const { i, calls } = command("team", { number: 9 });
    await h(i);
    expect(calls[1].payload.embeds[0]).toMatchObject({ title: "Team not found", description: "No team 9." });
    expect(log).not.toHaveBeenCalled();
  });

  it("the database being down: a friendly embed, the details only in the log, and the next ask tries again", async () => {
    const log = vi.fn();
    let fail = true;
    const l = lookups({ event: vi.fn(async (c: string) => { if (fail) throw new Error("SQLITE_BUSY: database is locked"); return ok(c); }) });
    const h = createHandler(log, l);
    const first = command("event", { code: "USTXAUQ" });
    await h(first.i);
    const shown = first.calls[1].payload.embeds[0];
    expect(shown.title).toBe("Something went wrong");
    expect(JSON.stringify(shown)).not.toMatch(/SQLITE/);
    expect(log).toHaveBeenCalledWith("/event code=USTXAUQ failed: SQLITE_BUSY: database is locked");
    fail = false;
    const second = command("event", { code: "USTXAUQ" });
    await h(second.i);
    expect(second.calls[1].payload.embeds[0].title).toBe("USTXAUQ");
  });

  it("Discord failing (an expired interaction) is logged, never thrown", async () => {
    const log = vi.fn();
    const h = createHandler(log, lookups());
    const { i } = command("rankings", {});
    i.deferReply = async () => { throw new Error("Unknown interaction"); };
    await expect(h(i)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith("interaction failed: Unknown interaction");
  });
});

describe("autocomplete", () => {
  const ac = (typed: string) => {
    const sent: any[] = [];
    const i = { commandName: "predict", isChatInputCommand: () => false, isAutocomplete: () => true, options: { getFocused: () => typed }, respond: async (x: any) => { sent.push(x); } };
    return { i: i as any, sent };
  };

  it("answers with the choices; a failure answers an empty list", async () => {
    const ok1 = ac("aus");
    await createHandler(() => {}, lookups())(ok1.i);
    expect(ok1.sent[0]).toEqual([{ name: "A (A)", value: "A" }]);
    const bad = ac("aus");
    await createHandler(() => {}, lookups({ choices: async () => { throw new Error("down"); } }))(bad.i);
    expect(bad.sent[0]).toEqual([]);
  });
});

describe("AnswerCache", () => {
  it("expires after its time", async () => {
    const c = new AnswerCache<number>(1000);
    const make = vi.fn(async () => 1);
    await c.get("k", make, 0);
    await c.get("k", make, 999);
    await c.get("k", make, 1000);
    expect(make).toHaveBeenCalledTimes(2);
  });

  it("keeps at most its size, dropping the oldest", async () => {
    const c = new AnswerCache<number>(60_000, 2);
    for (const k of ["a", "b", "c"]) await c.get(k, async () => 1);
    expect(c.size).toBe(2);
  });
});

describe("registration", () => {
  it("the commands, each one on the site's list; follow and unfollow need Manage Server, in servers only", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(["team", "predict", "event", "rankings", "follow", "unfollow", "following", "ask", "help"]);
    for (const c of COMMANDS) expect(BOT_COMMANDS.some((b) => b.usage.startsWith(`/${c.name}`)), c.name).toBe(true);
    for (const name of ["follow", "unfollow"]) {
      const c = COMMANDS.find((x) => x.name === name)!;
      expect(c.default_member_permissions).toBe("32"); // Manage Server
      expect(c.contexts).toEqual([0]); // guild only
    }
  });

  it("what Discord sends back for unchanged commands (ids, versions, defaults, any order) counts as the same", () => {
    const back = [...COMMANDS].reverse().map((c, n) => ({
      id: String(n), application_id: "1", version: "9", type: 1, default_member_permissions: null, nsfw: false,
      ...c, options: c.options?.map((o: any) => ({ ...o, required: o.required ?? false })),
    }));
    expect(sameCommands(back)).toBe(true);
  });

  it("a changed description, a missing command or an extra one is a change", () => {
    expect(sameCommands(COMMANDS.map((c) => (c.name === "team" ? { ...c, description: "old" } : c)))).toBe(false);
    expect(sameCommands(COMMANDS.slice(1))).toBe(false);
    expect(sameCommands([...COMMANDS, { name: "x", description: "y" }])).toBe(false);
  });
});

describe("follows", () => {
  function inGuild(name: string, options: Record<string, string | number>, channelOpt?: string) {
    const c = command(name, options);
    Object.assign(c.i, { guildId: "g1", channelId: "here", guild: undefined, options: { ...c.i.options, getChannel: () => (channelOpt ? { id: channelOpt } : null) } });
    return c;
  }

  it("/follow posts in this channel by default, or the one picked; /unfollow says what stopped", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    const a = inGuild("follow", { team: 18360 });
    await h(a.i);
    expect(l.follow).toHaveBeenCalledWith("g1", "here", 18360, "u1");
    expect(a.calls[1].payload.embeds[0].title).toBe("Following 18360");
    await h(inGuild("follow", { team: 4215 }, "c9").i);
    expect(l.follow).toHaveBeenLastCalledWith("g1", "c9", 4215, "u1");
    const u = inGuild("unfollow", { team: 18360 });
    await h(u.i);
    expect(u.calls[1].payload.embeds[0].title).toBe("Stopped following 18360");
  });

  it("never cached: a second /following reads again", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    await h(inGuild("following", {}).i);
    await h(inGuild("following", {}).i);
    expect(l.following).toHaveBeenCalledTimes(2);
  });

  it("outside a server (a DM): a friendly error", async () => {
    const { i, calls } = command("follow", { team: 1 });
    await createHandler(() => {}, lookups())(i);
    expect(calls[1].payload.embeds[0].title).toBe("Servers only");
  });

  it("/help lists every command", async () => {
    const { i, calls } = command("help", {});
    await createHandler(() => {}, lookups())(i);
    const text = calls[1].payload.embeds[0].description as string;
    for (const c of BOT_COMMANDS) expect(text).toContain(c.usage);
  });
});

describe("/ask's answers", () => {
  it("no waiting: a second ask right after the first is answered too", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    await h(command("ask", { question: "who won decode" }).i);
    const second = command("ask", { question: "4215 vs 6980" });
    await h(second.i);
    expect(second.calls.map((c) => c.kind)).toEqual(["defer", "edit"]);
  });

  it("the same question within a minute is one lookup (whoever asks, however it's cased), logged without who asked", async () => {
    const l = lookups();
    const logs: string[] = [];
    const h = createHandler((m) => logs.push(m), l);
    await h(command("ask", { question: "who won decode" }, "u1").i);
    await h(command("ask", { question: "Who won DECODE" }, "u2").i);
    expect(l.ask).toHaveBeenCalledTimes(1);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/^\/ask question=WHO WON DECODE step=deterministic bruno=no \d+ms$/);
    expect(logs[1]).toMatch(/ cached \d+ms$/);
    expect(logs.join(" ")).not.toMatch(/u1|u2/);
  });

  it("ten asks in a minute from one person: every one answered, one lookup for the question", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    const replies = [];
    for (let n = 0; n < 10; n++) { const c = command("ask", { question: "who won decode" }, "spam"); await h(c.i); replies.push(c.calls[0].kind); }
    expect(replies.filter((k) => k === "defer")).toHaveLength(10);
    expect(replies.filter((k) => k === "reply")).toHaveLength(0);
    expect(l.ask).toHaveBeenCalledTimes(1);
    const other = command("ask", { question: "who won decode" }, "someone");
    await h(other.i);
    expect(other.calls[1].payload.embeds[0].title).toBe("ask who won decode");
  });

  it("turned off by the owner: /ask gets the turned-off note and nothing runs", async () => {
    const l = lookups({ enabled: async (f) => f !== "discordBot" });
    const h = createHandler(() => {}, l);
    const { i, calls } = command("ask", { question: "who won decode" });
    await h(i);
    expect(calls[0].payload.embeds[0].title).toBe("Turned off for now");
    expect(l.ask).not.toHaveBeenCalled();
  });
});

describe("@mention answers", () => {
  const BOT = "1562258217873047562";
  function msg(content: string, over: Partial<MentionMessage> = {}) {
    const sent: { kind: string; embeds: APIEmbed[] }[] = [];
    const m: MentionMessage = {
      author: { id: "u1", bot: false }, guildId: "g1", content,
      reply: vi.fn(async (o) => { sent.push({ kind: "reply", embeds: o.embeds }); }),
      channel: { send: vi.fn(async (o) => { sent.push({ kind: "send", embeds: o.embeds }); }), sendTyping: vi.fn(async () => {}) },
      ...over,
    };
    return { m, sent };
  }

  it("\"@Control Scout who won decode\" answers as /ask does, as a reply, sharing /ask's cache", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    const { m, sent } = msg(`<@${BOT}> who won decode`);
    await h.mention(m, BOT);
    expect(l.ask).toHaveBeenCalledWith("who won decode", []);
    expect(sent).toHaveLength(1);
    expect(sent[0].kind).toBe("reply");
    expect(sent[0].embeds[0].title).toBe("ask who won decode");
    await h(command("ask", { question: "Who won decode" }, "u2").i);
    expect(l.ask).toHaveBeenCalledTimes(1);
  });

  it("stays silent unless the bot itself is mentioned by a person in a server", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    for (const { m } of [msg("who won decode"), msg("<@999> who won decode"), msg("@everyone who won decode"), msg(`<@${BOT}> hi`, { author: { id: "b", bot: true } }), msg(`<@${BOT}> hi`, { guildId: null })]) await h.mention(m, BOT);
    expect(l.ask).not.toHaveBeenCalled();
  });

  it("just the mention: how to ask; a reply it can't make: a plain message; back-to-back mentions: both answered; turned off: the note", async () => {
    const h = createHandler(() => {}, lookups());
    const empty = msg(`<@!${BOT}>`, { reply: vi.fn(async () => { throw new Error("Missing Permissions"); }) });
    await h.mention(empty.m, BOT);
    expect(empty.sent.map((s) => [s.kind, s.embeds[0].title])).toEqual([["send", "Ask me anything"]]);
    // Two mentions from one person, one right after the other: the second is answered too (no pace limit).
    const first = msg(`<@${BOT}> 4215`);
    await h.mention(first.m, BOT);
    const second = msg(`<@${BOT}> 4215`);
    await h.mention(second.m, BOT);
    expect(first.sent).toHaveLength(1);
    expect(second.sent).toHaveLength(1);
    const off = msg(`<@${BOT}> 4215`);
    await createHandler(() => {}, lookups({ enabled: async (f) => f !== "discordBot" })).mention(off.m, BOT);
    expect(off.sent[0].embeds[0].title).toBe("Turned off for now");
  });
});

describe("an answer with a video", () => {
  it("sends the video link as the message's text, for /ask and a mention alike", async () => {
    const l = lookups({ ask: vi.fn(async (q: string) => ({ embed: { title: `ask ${q}` }, meta: { step: "deterministic" as const, refined: false, sentence: false }, content: "https://www.youtube.com/watch?v=AAA" })) });
    const h = createHandler(() => {}, l);
    const c = command("ask", { question: "23268 highlights" });
    await h(c.i);
    expect(c.calls.at(-1)!.payload.content).toBe("https://www.youtube.com/watch?v=AAA");
    const sent: unknown[] = [];
    await h.mention({ author: { id: "u9", bot: false }, guildId: "g", content: "<@1> 23268 highlights", reply: async (o) => { sent.push(o); }, channel: {} }, "1");
    expect((sent[0] as { content?: string }).content).toBe("https://www.youtube.com/watch?v=AAA");
  });
});

describe("the ask cache key", () => {
  it("is the whole question: two long questions alike for 100 characters are answered apart", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    const head = "x".repeat(120);
    await h(command("ask", { question: `${head} one` }, "a").i);
    await h(command("ask", { question: `${head} two` }, "b").i);
    expect(l.ask).toHaveBeenCalledTimes(2);
    await h(command("ask", { question: `${head}   ONE` }, "c").i);
    expect(l.ask).toHaveBeenCalledTimes(2);
  });
});

describe("a chat with Bruno in Discord", () => {
  const BOT = "77";
  const chatAsk = () => vi.fn(async (q: string, history?: unknown[]) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false, chat: true }, chat: { text: `re: ${q} (${(history ?? []).length})` } }));
  function message(content: string, over: Partial<MentionMessage> = {}, id = "m1") {
    const sent: any[] = [];
    const m: MentionMessage = { author: { id: "u1", bot: false }, guildId: "g", content, reply: async (o) => { sent.push(o); return { id }; }, channel: {}, ...over };
    return { m, sent };
  }

  it("a mention gets his reply as plain text, no embed; /ask quotes the question", async () => {
    const h = createHandler(() => {}, lookups({ ask: chatAsk() }));
    const { m, sent } = message(`<@${BOT}> hi bruno`);
    await h.mention(m, BOT);
    expect(sent[0]).toMatchObject({ content: "re: hi bruno (0)\n-# Bruno AI · controlscout.org", embeds: [] });
    const c = command("ask", { question: "who won decode" });
    await h(c.i);
    expect(c.calls.at(-1)!.payload).toEqual({ content: "> **who won decode**\nre: who won decode (0)\n-# Bruno AI · controlscout.org", embeds: [], allowedMentions: { parse: [], repliedUser: false } });
  });

  it("a reply to his answer carries the thread on, even without a mention; replies to others or with no text are left alone", async () => {
    const ask = chatAsk();
    const h = createHandler(() => {}, lookups({ ask }));
    await h.mention(message(`<@${BOT}> who won decode`, {}, "bot-1").m, BOT);
    const follow = message("and second?", { reference: { messageId: "bot-1" }, mentions: { repliedUser: { id: BOT } } }, "bot-2");
    await h.mention(follow.m, BOT);
    expect(ask).toHaveBeenLastCalledWith("and second?", [{ role: "user", text: "who won decode" }, { role: "bruno", text: "re: who won decode (0)" }]);
    expect(follow.sent[0].content).toMatch(/^re: and second\? \(2\)/);
    await h.mention(message("and third?", { reference: { messageId: "bot-2" }, mentions: { repliedUser: { id: BOT } } }).m, BOT);
    expect((ask.mock.calls.at(-1) as unknown[])[1]).toHaveLength(4);
    const n = ask.mock.calls.length;
    await h.mention(message("hello", { reference: { messageId: "x" }, mentions: { repliedUser: { id: "someone" } } }).m, BOT);
    await h.mention(message("", { reference: { messageId: "bot-1" }, mentions: { repliedUser: { id: BOT } } }).m, BOT);
    expect(ask).toHaveBeenCalledTimes(n);
  });

  it("the bot's own small talk isn't remembered as Bruno's: a reply to it starts a new thread", async () => {
    const ask = vi.fn(async (q: string) => ({
      embed: ok(`ask ${q}`),
      meta: { step: "recovery" as const, refined: false, sentence: false, chat: true },
      chat: { text: "Hey — I'm Control Scout.", by: "scout" as const },
    }));
    const h = createHandler(() => {}, lookups({ ask }));
    await h.mention(message(`<@${BOT}> hi`, {}, "bot-1").m, BOT);
    const follow = message("who won decode", { reference: { messageId: "bot-1" }, mentions: { repliedUser: { id: BOT } } }, "bot-2");
    await h.mention(follow.m, BOT);
    expect(ask).toHaveBeenLastCalledWith("who won decode", []);
  });
});

describe("answers ping nobody", () => {
  it("a reply, the fallback plain message and /ask all send with no mentions allowed", async () => {
    const pinged = { text: "@everyone <@&5> <@9> look", search: false };
    const ask = vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false, chat: true }, chat: pinged }));
    const h = createHandler(() => {}, lookups({ ask }));
    const opts: any[] = [];
    await h.mention({ author: { id: "u", bot: false }, guildId: "g", content: "<@7> hi", reply: async (o) => { opts.push(o); }, channel: {} }, "7");
    await h.mention({ author: { id: "u", bot: false }, guildId: "g", content: "<@7> yo", reply: async () => { throw new Error("Missing Permissions"); }, channel: { send: async (o) => { opts.push(o); } } }, "7");
    const c = command("ask", { question: "hey" });
    await h(c.i);
    opts.push(c.calls.at(-1)!.payload);
    expect(opts).toHaveLength(3);
    for (const o of opts) expect(o.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });
});

describe("a server's chat limit", () => {
  const BOT = "1562258217873047562";
  const atLimit = { ok: false as const, limited: "hour" as const, retryAfter: 1800 };

  function message(content: string) {
    const sent: { kind: string; embeds: APIEmbed[] }[] = [];
    const m: MentionMessage = {
      author: { id: "u1", bot: false }, guildId: "g1", content,
      reply: vi.fn(async (o) => { sent.push({ kind: "reply", embeds: o.embeds }); return { id: "m1" }; }),
      channel: { send: vi.fn(async (o) => { sent.push({ kind: "send", embeds: o.embeds }); }), sendTyping: vi.fn(async () => {}) },
    };
    return { m, sent };
  }

  it("no limit set — every server today — so a mention answers as always", async () => {
    const l = lookups({ quota: vi.fn(async () => ({ ok: true as const })) });
    const { m, sent } = message(`<@${BOT}> who won decode`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("ask who won decode");
    expect(l.quota).toHaveBeenCalledWith("g1");
  });

  it("at the limit: a mention gets a plain note instead of an answer, and nothing is looked up", async () => {
    const l = lookups({ quota: vi.fn(async () => atLimit) });
    const { m, sent } = message(`<@${BOT}> who won decode`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(sent).toHaveLength(1);
    expect(sent[0].embeds[0].title).toBe("This server's limit is reached");
    expect(sent[0].embeds[0].description).toContain("each hour");
    expect(sent[0].embeds[0].description).toContain("30 minutes");
    // The site and the server's follows are untouched, and the bot doesn't mention anyone.
    expect(sent[0].embeds[0].description).toContain("controlscout.org still works");
    expect(l.ask).not.toHaveBeenCalled();
  });

  it("/ask at the limit says the same, and a day's limit says how many hours until it resets", async () => {
    const l = lookups({ quota: vi.fn(async () => ({ ok: false as const, limited: "day" as const, retryAfter: 25 * 3600 })) });
    const h = createHandler(() => {}, l);
    const c = command("ask", { question: "who won decode" });
    c.i.guildId = "g1";
    await h(c.i);
    expect(c.calls.map((k) => k.kind)).toEqual(["defer", "edit"]);
    expect(c.calls[1].payload.embeds[0].title).toBe("This server's limit is reached");
    expect(c.calls[1].payload.embeds[0].description).toContain("each day");
    expect(c.calls[1].payload.embeds[0].description).toContain("25 hours");
    expect(l.ask).not.toHaveBeenCalled();
  });

  it("a bare mention asks for the help text without using a chat", async () => {
    const quota = vi.fn(async () => atLimit);
    const { m, sent } = message(`<@${BOT}>`);
    await createHandler(() => {}, lookups({ quota })).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("Ask me anything");
    expect(quota).not.toHaveBeenCalled();
  });

  it("a quota read that fails never silences the bot", async () => {
    const l = lookups({ quota: async () => { throw new Error("database is locked"); } });
    const { m, sent } = message(`<@${BOT}> who won decode`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("ask who won decode");
    expect(l.ask).toHaveBeenCalledTimes(1);
  });
});
