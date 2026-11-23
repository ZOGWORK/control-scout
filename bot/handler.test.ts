// The interaction handler with stand-in interactions: deferred replies, the shared cache, no per-person pace, and
// friendly errors for every failure (never the exception's words).
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { createHandler, type Lookups, type Memory, type MentionMessage } from "./handler";
import type { Filed, Report } from "./report";
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
    deferReply: async (payload?: any) => { calls.push({ kind: "defer", payload }); },
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
    config: vi.fn(async () => ok("config here")),
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
    expect(calls[0].payload).toBeUndefined(); // a public answer, as before
  });

  it("/config answers privately, with the bot's own setup (not in the channel's history)", async () => {
    const l = lookups();
    const { i, calls } = command("config", {});
    i.guildId = "g1";
    await createHandler(() => {}, l)(i);
    expect(calls.map((c) => c.kind)).toEqual(["defer", "edit"]);
    expect(calls[0].payload).toEqual({ flags: 64 }); // MessageFlags.Ephemeral
    expect(calls[1].payload.embeds[0].title).toBe("config here");
    // Read for the server it was asked in: its chat limit is part of the answer (bot/config.ts).
    expect(l.config).toHaveBeenCalledWith("g1");
    expect(l.team).not.toHaveBeenCalled();
  });

  it("/config without the lookup says it couldn't read it, rather than failing", async () => {
    const { i, calls } = command("config", {});
    await createHandler(() => {}, lookups({ config: undefined }))(i);
    expect(calls[1].payload.embeds[0].title).toBe("Couldn't read the config");
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
  it("the commands, each one on the site's list; follow, unfollow and config need Manage Server, in servers only", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(["team", "predict", "event", "rankings", "follow", "unfollow", "following", "ask", "config", "help"]);
    for (const c of COMMANDS) expect(BOT_COMMANDS.some((b) => b.usage.startsWith(`/${c.name}`)), c.name).toBe(true);
    for (const name of ["follow", "unfollow", "config"]) {
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
    expect(l.follow).toHaveBeenCalledWith("g1", "here", { kind: "team", team: 18360 }, "u1");
    expect(a.calls[1].payload.embeds[0].title).toBe("Following 18360");
    await h(inGuild("follow", { team: 4215 }, "c9").i);
    expect(l.follow).toHaveBeenLastCalledWith("g1", "c9", { kind: "team", team: 4215 }, "u1");
    const u = inGuild("unfollow", { team: 18360 });
    await h(u.i);
    expect(u.calls[1].payload.embeds[0].title).toBe("Stopped following 18360");
  });

  it("/follow event: follows a whole event, and says which; a follow with neither, or both, is a friendly error", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    const e = inGuild("follow", { event: "ustxauq" });
    await h(e.i);
    expect(l.follow).toHaveBeenCalledWith("g1", "here", { kind: "event", event: "USTXAUQ" }, "u1");
    expect(e.calls[1].payload.embeds[0].title).toBe("Following USTXAUQ");
    expect(e.calls[1].payload.embeds[0].description).toMatch(/recap at the end of each day/);
    const u = inGuild("unfollow", { event: "USTXAUQ" });
    await h(u.i);
    expect(l.unfollow).toHaveBeenLastCalledWith("g1", { kind: "event", event: "USTXAUQ" }, null);
    const none = inGuild("follow", {});
    await h(none.i);
    expect(none.calls[1].payload.embeds[0].title).toBe("Team or event?");
    const both = inGuild("follow", { team: 4215, event: "USTXAUQ" });
    await h(both.i);
    expect(both.calls[1].payload.embeds[0].title).toBe("One at a time");
  });

  it("an event typed by its name is followed by its code, the way /event resolves one", async () => {
    const eventCode = vi.fn(async (input: string) => (input === "Austin Qualifier" ? "USTXAUQ" : input.toUpperCase()));
    const l = lookups({ eventCode });
    const h = createHandler(() => {}, l);
    const e = inGuild("follow", { event: "Austin Qualifier" });
    await h(e.i);
    expect(eventCode).toHaveBeenCalledWith("Austin Qualifier");
    expect(l.follow).toHaveBeenCalledWith("g1", "here", { kind: "event", event: "USTXAUQ" }, "u1");
    // /unfollow resolves the same way, so a name stops the follow a name started.
    const u = inGuild("unfollow", { event: "Austin Qualifier" });
    await h(u.i);
    expect(l.unfollow).toHaveBeenLastCalledWith("g1", { kind: "event", event: "USTXAUQ" }, null);
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
    expect(l.ask).toHaveBeenCalledWith("who won decode", [], [], "g1");
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
    expect(c.calls.at(-1)!.payload).toMatchObject({ content: "> **who won decode**\nre: who won decode (0)\n-# Bruno AI · controlscout.org", embeds: [], allowedMentions: { parse: [], repliedUser: false } });
  });

  it("a reply to his answer carries the thread on, even without a mention; replies to others or with no text are left alone", async () => {
    const ask = chatAsk();
    const h = createHandler(() => {}, lookups({ ask }));
    await h.mention(message(`<@${BOT}> who won decode`, {}, "bot-1").m, BOT);
    const follow = message("and second?", { reference: { messageId: "bot-1" }, mentions: { repliedUser: { id: BOT } } }, "bot-2");
    await h.mention(follow.m, BOT);
    expect(ask).toHaveBeenLastCalledWith("and second?", [{ role: "user", text: "who won decode" }, { role: "bruno", text: "re: who won decode (0)" }], [], "g");
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
    expect(ask).toHaveBeenLastCalledWith("who won decode", [], [], "g");
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

describe("the answer's buttons", () => {
  const card = (q: string) => ({
    embed: { title: `ask ${q}`, url: `https://controlscout.org/search?q=${encodeURIComponent(q)}` },
    meta: { step: "deterministic" as const, refined: false, sentence: false },
    next: ["4215 awards"],
    watch: [{ label: "Q85", url: "https://youtu.be/A" }],
  });

  function button(customId: string, over: Record<string, unknown> = {}) {
    const calls: { kind: string; payload?: any }[] = [];
    const i = {
      customId, guildId: "g1", user: { id: "u1" },
      isChatInputCommand: () => false, isAutocomplete: () => false, isButton: () => true,
      reply: async (p: any) => { calls.push({ kind: "reply", payload: p }); },
      deferReply: async (p?: any) => { calls.push({ kind: "defer", payload: p }); },
      editReply: async (p: any) => { calls.push({ kind: "edit", payload: p }); return { id: "m2" }; },
      ...over,
    };
    return { i: i as any, calls };
  }

  it("a card carries a row of questions and a row of links; a click asks the question as /ask does", async () => {
    const ask = vi.fn(async (q: string) => card(q));
    const h = createHandler(() => {}, lookups({ ask }));
    const c = command("ask", { question: "4215" });
    c.i.guildId = "g1";
    await h(c.i);
    const post = c.calls.at(-1)!.payload;
    expect(post.components).toHaveLength(2);
    expect(post.components[0].components[0]).toMatchObject({ type: 2, style: 2, label: "4215 awards" });
    expect(post.components[0].components[0].custom_id).toMatch(/^ask:/);
    expect(post.components[1].components.map((b: any) => b.label)).toEqual(["Open on controlscout.org", "Q85"]);
    expect(post.components[1].components[0].url).toBe("https://controlscout.org/search?q=4215");
    // The click answers in the channel, as /ask would (with the make-up the channel needs to see).
    const b = button(post.components[0].components[0].custom_id);
    await h(b.i);
    expect(ask).toHaveBeenLastCalledWith("4215 awards", [], [], "g1");
    expect(b.calls.map((x) => x.kind)).toEqual(["defer", "edit"]);
    expect(b.calls[1].payload.embeds[0].title).toBe("ask 4215 awards");
    expect(b.calls[1].payload.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it("an expired button (an hour old, or from before a restart) says so instead of guessing", async () => {
    const ask = vi.fn(async (q: string) => card(q));
    const b = button("ask:never-made");
    await createHandler(() => {}, lookups({ ask }))(b.i);
    expect(b.calls).toHaveLength(1);
    expect(b.calls[0].kind).toBe("reply");
    expect(b.calls[0].payload.content).toMatch(/expired/);
    expect(b.calls[0].payload.flags).toBe(64); // ephemeral
    expect(ask).not.toHaveBeenCalled();
  });

  it("at a server's chat limit a button says when it resets, and asks nothing", async () => {
    const ask = vi.fn(async (q: string) => card(q));
    // The first ask fits (so its answer has a button); the click after it is the one over the limit.
    type Limit = { ok: true } | { ok: false; limited: "hour"; retryAfter: number };
    const quota = vi.fn(async (): Promise<Limit> => ({ ok: true }))
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValue({ ok: false, limited: "hour", retryAfter: 1800 });
    const h = createHandler(() => {}, lookups({ ask, quota }));
    const c = command("ask", { question: "4215" });
    c.i.guildId = "g1";
    await h(c.i);
    const id = c.calls.at(-1)!.payload.components[0].components[0].custom_id;
    const b = button(id);
    await h(b.i);
    expect(b.calls[0].payload.embeds[0].title).toBe("This server's limit is reached");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("records what it was asked, and adds 👍 and 👎 to the answer", async () => {
    const noteAsk = vi.fn(async () => {});
    const trackAnswer = vi.fn(async () => {});
    const react = vi.fn(async (_emoji: string) => ({}));
    const h = createHandler(() => {}, lookups({ noteAsk, trackAnswer }));
    const c = command("ask", { question: "who won decode" });
    c.i.guildId = "g1";
    c.i.editReply = async (p: any) => { c.calls.push({ kind: "edit", payload: p }); return { id: "m9", react }; };
    await h(c.i);
    expect(noteAsk).toHaveBeenCalledWith({ question: "who won decode", step: "deterministic", chat: false, answered: true, ms: expect.any(Number), guild: "g1" });
    expect(trackAnswer).toHaveBeenCalledWith("m9", "g1");
    expect(react.mock.calls.map((x) => x[0])).toEqual(["👍", "👎"]);
  });

  it("the bot's own fallback is counted as not answered, Bruno's reply as answered", async () => {
    const noteAsk = vi.fn(async () => {});
    const h = createHandler(() => {}, lookups({
      noteAsk,
      ask: vi.fn(async (q: string) => ({ embed: { title: q }, meta: { step: "recovery" as const, refined: false, sentence: false, chat: true }, chat: { text: "I can't chat right now.", by: "scout" as const } })),
    }));
    const c = command("ask", { question: "hey" });
    c.i.guildId = "g1";
    await h(c.i);
    // A chat that is the bot's own fallback is neither answered nor Bruno's.
    expect(noteAsk).toHaveBeenLastCalledWith(expect.objectContaining({ chat: false, answered: false }));
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

  it("a server under its limit (the default, unless its own row says otherwise) answers as always", async () => {
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

describe("what the server has taught the bot", () => {
  const BOT = "1562258217873047562";

  function memory(over: Partial<Memory> = {}): Memory {
    return {
      recall: vi.fn(async () => ({ teams: [] as number[], name: null })),
      learn: vi.fn(async () => {}),
      thread: vi.fn(async () => []),
      keep: vi.fn(async () => {}),
      ...over,
    };
  }
  function message(content: string, author: Partial<MentionMessage["author"]> = {}, over: Partial<MentionMessage> = {}) {
    const sent: { kind: string; embeds: APIEmbed[] }[] = [];
    const m: MentionMessage = {
      author: { id: "u1", bot: false, ...author }, guildId: "g1", content,
      reply: vi.fn(async (o) => { sent.push({ kind: "reply", embeds: o.embeds }); return { id: "m1" }; }),
      channel: { send: vi.fn(async (o) => { sent.push({ kind: "send", embeds: o.embeds }); }), sendTyping: vi.fn(async () => {}) },
      ...over,
    };
    return { m, sent };
  }
  const chatAnswer = (text = "**4215's auto OPR was 12.4 at their last event.**") => vi.fn(async (q: string) => ({
    embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false, chat: true }, chat: { text },
  }));

  it("sends the server's teams and the asker's name with the chat, and remembers the name and the team asked about", async () => {
    const mem = memory({ recall: vi.fn(async () => ({ teams: [4215, 6980], name: "Alex" })) });
    const l = lookups({ memory: mem, ask: chatAnswer() });
    await createHandler(() => {}, l).mention(message(`<@${BOT}> what was 4215's auto OPR at the last event?`, { globalName: "Alex" }).m, BOT);
    const lines = vi.mocked(l.ask).mock.calls[0][2] as string[];
    expect(lines[0]).toContain("teams 4215, 6980");
    expect(lines[0]).toContain("say which one you picked");
    expect(lines[1]).toContain("goes by Alex");
    expect(mem.recall).toHaveBeenCalledWith("g1", "u1");
    expect(mem.learn).toHaveBeenCalledWith("g1", "u1", "Alex", [4215]);
  });

  it("/ask learns the same, from the command's own server and person", async () => {
    const mem = memory();
    const l = lookups({ memory: mem, ask: chatAnswer() });
    const c = command("ask", { question: "4215 highlights" });
    c.i.guildId = "g1";
    c.i.user = { id: "u1", globalName: "Alex" };
    await createHandler(() => {}, l)(c.i);
    expect(mem.learn).toHaveBeenCalledWith("g1", "u1", "Alex", [4215]);
  });

  it("a reply to an answer from before a restart still carries its thread", async () => {
    const turns = [{ role: "user" as const, text: "who won decode" }, { role: "bruno" as const, text: "30030 won." }];
    const mem = memory({ thread: vi.fn(async () => turns) });
    const l = lookups({ memory: mem, ask: chatAnswer() });
    await createHandler(() => {}, l).mention(message("and second?", {}, { reference: { messageId: "old" }, mentions: { repliedUser: { id: BOT } } }).m, BOT);
    expect(mem.thread).toHaveBeenCalledWith("old");
    expect(l.ask).toHaveBeenCalledWith("and second?", turns, [], "g1");
  });

  it("keeps the answer's thread, so a reply to it carries on even after a deploy", async () => {
    const mem = memory();
    const l = lookups({ memory: mem, ask: chatAnswer("30030 Exodus won.") });
    await createHandler(() => {}, l).mention(message(`<@${BOT}> who won decode`).m, BOT);
    // Kept with its server, so removing the bot from that server deletes it (bot/forget.ts).
    expect(mem.keep).toHaveBeenCalledWith("m1", [
      { role: "user", text: "who won decode" },
      { role: "bruno", text: "30030 Exodus won." },
    ], "g1");
  });

  it("a memory that fails changes nothing: the question is still answered", async () => {
    // (kept last in this block: it is the only one that lets every memory call throw)
    const mem = memory({
      recall: async () => { throw new Error("database is locked"); },
      learn: async () => { throw new Error("database is locked"); },
      thread: async () => { throw new Error("database is locked"); },
      keep: async () => { throw new Error("database is locked"); },
    });
    const l = lookups({ memory: mem, ask: chatAnswer() });
    const { m, sent } = message(`<@${BOT}> 4215`, {}, { reference: { messageId: "old" }, mentions: { repliedUser: { id: BOT } } });
    await createHandler(() => {}, l).mention(m, BOT);
    expect(l.ask).toHaveBeenCalledTimes(1);
    expect(sent[0].embeds).toEqual([]);
  });
});

describe("\"Report this to ControlScout\"", () => {
  const BOT = "1562258217873047562";
  const filed = { ok: true as const, number: 42, url: "https://github.com/ZOGWORK/control-scout/issues/42" };

  function message(content: string, over: Partial<MentionMessage> = {}) {
    const sent: { kind: string; embeds: APIEmbed[] }[] = [];
    const m: MentionMessage = {
      id: "msg-1", author: { id: "u1", bot: false, globalName: "Alex" }, guildId: "g1", channelId: "c1", content,
      reply: vi.fn(async (o) => { sent.push({ kind: "reply", embeds: o.embeds }); return { id: "m1" }; }),
      channel: { send: vi.fn(async (o) => { sent.push({ kind: "send", embeds: o.embeds }); }), sendTyping: vi.fn(async () => {}) },
      ...over,
    };
    return { m, sent };
  }

  it("files one report with what the bot can see, and says where it is", async () => {
    const report = vi.fn(async (_r: Report) => filed);
    const l = lookups({ report });
    const { m, sent } = message(`<@${BOT}> Report this to ControlScout`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(report).toHaveBeenCalledTimes(1);
    expect(vi.mocked(report).mock.calls[0][0]).toMatchObject({
      guild: "g1", channel: "c1", user: "u1", name: "Alex", message: "Report this to ControlScout", thread: [], logs: [],
    });
    expect(sent[0].embeds[0].title).toBe("Reported");
    expect(sent[0].embeds[0].description).toContain("#42");
    expect(sent[0].embeds[0].description).toContain("issues/42");
    // A report is not a chat: the search answer is never asked for.
    expect(l.ask).not.toHaveBeenCalled();
  });

  it("the same report a moment later points at the same issue instead of opening another", async () => {
    const report = vi.fn(async (_r: Report) => filed);
    const h = createHandler(() => {}, lookups({ report }));
    await h.mention(message(`<@${BOT}> report this to ControlScout`).m, BOT);
    const second = message(`<@${BOT}> report this to ControlScout`);
    await h.mention(second.m, BOT);
    expect(report).toHaveBeenCalledTimes(1);
    expect(second.sent[0].embeds[0].title).toBe("Reported");
    expect(second.sent[0].embeds[0].description).toContain("#42");
  });

  it("two members' different reports are two issues, even a moment apart in one channel", async () => {
    const report = vi.fn(async (_r: Report) => filed);
    const h = createHandler(() => {}, lookups({ report }));
    await h.mention(message(`<@${BOT}> report this to ControlScout`).m, BOT);
    await h.mention(message(`<@${BOT}> report this to ControlScout`, { id: "msg-2" }).m, BOT);
    expect(report).toHaveBeenCalledTimes(2);
  });

  it("the same message asked for twice at once files one issue", async () => {
    let release!: (r: Filed) => void;
    const report = vi.fn(() => new Promise<Filed>((res) => { release = res; }));
    const h = createHandler(() => {}, lookups({ report }));
    const first = h.mention(message(`<@${BOT}> report this to ControlScout`).m, BOT);
    // Let the first reach the awaiting file call, then ask again for the same message.
    await new Promise((r) => setTimeout(r, 10));
    const second = h.mention(message(`<@${BOT}> report this to ControlScout`).m, BOT);
    await new Promise((r) => setTimeout(r, 10));
    release(filed);
    await Promise.all([first, second]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("the thread before it goes with the report, and its log too", async () => {
    const report = vi.fn(async (_r: Report) => filed);
    const turns = [{ role: "user" as const, text: "who won decode" }, { role: "bruno" as const, text: "30030 won." }];
    const h = createHandler(() => {}, lookups({ report, memory: { recall: vi.fn(async () => ({ teams: [], name: null })), learn: vi.fn(async () => {}), thread: vi.fn(async () => turns), keep: vi.fn(async () => {}) } }));
    await h.mention(message(`<@${BOT}> report this to ControlScout`, { reference: { messageId: "old" }, mentions: { repliedUser: { id: BOT } } }).m, BOT);
    expect(vi.mocked(report).mock.calls[0][0]).toMatchObject({ thread: turns, logs: [] });
  });

  it("over the hourly cap, it says so instead of filing", async () => {
    const report = vi.fn(async (): Promise<Filed> => ({ ok: false, limited: true, reason: "too many reports from that person this hour" }));
    const { m, sent } = message(`<@${BOT}> report this to ControlScout`);
    await createHandler(() => {}, lookups({ report })).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("That's a lot of reports");
  });

  it("when it can't file, it says so plainly and logs why (never throwing)", async () => {
    const log = vi.fn();
    const report = vi.fn(async () => ({ ok: false as const, reason: "GitHub answered 403" }));
    const { m, sent } = message(`<@${BOT}> report this to ControlScout`);
    await createHandler(log, lookups({ report })).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("Couldn't file that report");
    expect(log.mock.calls.flat().join(" ")).toContain("report failed: GitHub answered 403");
  });

  it("a report that throws is a failed report, not a failed mention", async () => {
    const report = async () => { throw new Error("no answer"); };
    const { m, sent } = message(`<@${BOT}> report this to ControlScout`);
    await createHandler(() => {}, lookups({ report })).mention(m, BOT);
    expect(sent[0].embeds[0].title).toBe("Couldn't file that report");
  });

  it("an ordinary question never files one", async () => {
    const report = vi.fn(async () => filed);
    const l = lookups({ report, ask: vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false, chat: true }, chat: { text: "30030 won." } })) });
    await createHandler(() => {}, l).mention(message(`<@${BOT}> who won decode`).m, BOT);
    expect(report).not.toHaveBeenCalled();
    expect(l.ask).toHaveBeenCalledTimes(1);
  });
});
