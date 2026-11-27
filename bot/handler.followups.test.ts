// The follow-up features in the handler: /settings (what this server gets, and changing it), no per-person pace, the
// report button and its modal, and team autocomplete.
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { createHandler, type Lookups } from "./handler";
import { DEFAULT_SETTINGS } from "./settings";

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
      getChannel: () => null,
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
    predict: vi.fn(async () => ok("predict")),
    event: vi.fn(async () => ok("event")),
    rankings: vi.fn(async () => ok("rankings")),
    choices: vi.fn(async () => [{ name: "A (A)", value: "A" }]),
    follow: vi.fn(async () => "added" as const),
    unfollow: vi.fn(async () => 1),
    following: vi.fn(async () => ok("following")),
    ask: vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false } })),
    ...over,
  };
}

describe("/settings", () => {
  it("shows what this server gets, privately, when nothing is asked for", async () => {
    const settings = vi.fn(async () => ({ ...DEFAULT_SETTINGS }));
    const { i, calls } = command("settings");
    // Showing the settings needs no write path: only changing them does.
    await createHandler(() => {}, lookups({ settings }))(i);
    expect(calls[0].payload).toEqual({ flags: 64 }); // ephemeral: the server's own setup
    const e = calls[1].payload.embeds[0];
    expect(e.title).toBe("How this server gets its posts");
    expect(e.description).toContain("Quiet hours:** none");
    expect(e.description).toContain("Match reminders:** on");
  });

  it("changes only what was asked, and refuses quiet hours it can't read", async () => {
    const saveSettings = vi.fn(async () => {});
    const settings = vi.fn(async () => ({ ...DEFAULT_SETTINGS, quiet: { start: 22, end: 7 } }));
    const h = createHandler(() => {}, lookups({ settings, saveSettings }));
    const changed = command("settings", { quiet_hours: "off" });
    await h(changed.i);
    // The rest of the state is carried over, not reset: reminders stay on and no ping role appears.
    expect(saveSettings).toHaveBeenCalledWith("g1", { quiet: null, reminders: true, pingRole: null }, "u1");

    const bad = command("settings", { quiet_hours: "25-99" });
    await h(bad.i);
    expect(bad.calls[1].payload.embeds[0].title).toBe("Quiet hours?");
    expect(saveSettings).toHaveBeenCalledTimes(1);

    const ping = command("settings", { ping_role: "<@&123456789012345678>" });
    await h(ping.i);
    expect(saveSettings).toHaveBeenLastCalledWith("g1", { quiet: { start: 22, end: 7 }, reminders: true, pingRole: "123456789012345678" }, "u1");

    const none = command("settings", { ping_role: "none" });
    await h(none.i);
    expect(saveSettings).toHaveBeenLastCalledWith("g1", { quiet: { start: 22, end: 7 }, reminders: true, pingRole: null }, "u1");

    // @everyone's role id is the server's own id, and `<@&server>` pings everyone: refused, not saved.
    const everyone = command("settings", { ping_role: "987654321098765432" }, "u1", "987654321098765432");
    await h(everyone.i);
    expect(everyone.calls[1].payload.embeds[0].title).toBe("Which role?");
    expect(everyone.calls[1].payload.embeds[0].description).toContain("@everyone");
    expect(saveSettings).toHaveBeenCalledTimes(3);
  });

  it("says it needs a server rather than quietly changing nothing", async () => {
    const { i, calls } = command("settings");
    i.guildId = null;
    await createHandler(() => {}, lookups({ settings: async () => ({ ...DEFAULT_SETTINGS }) }))(i);
    expect(calls[1].payload.embeds[0].title).toBe("Servers only");
  });
});

describe("no per-person pace", () => {
  it("answers every /ask and mention from one person, however many in a row", async () => {
    const ask = vi.fn(async () => ({ embed: ok("x"), meta: { step: "deterministic" as const, refined: false, sentence: false } }));
    const h = createHandler(() => {}, lookups({ ask }));
    for (let n = 0; n < 35; n++) await h(command("ask", { question: `${2000 + n} opr` }).i);
    for (let n = 0; n < 10; n++) {
      await (h as any).mention({
        author: { id: "u1", bot: false }, guildId: "g1", channelId: "c1", id: `m${n}`, content: `<@1> ${3000 + n} opr`,
        reply: async () => ({}), channel: {},
      }, "1");
    }
    expect(ask).toHaveBeenCalledTimes(45);
  });
});

describe("the report button", () => {
  it("opens a modal instead of a reply", async () => {
    const showModal = vi.fn(async () => {});
    const h = createHandler(() => {}, lookups({ report: vi.fn(async () => ({ ok: false as const, reason: "off" })) }));
    await h({ customId: "report:answer", guildId: "g1", user: { id: "u1" }, isChatInputCommand: () => false, isAutocomplete: () => false, isButton: () => true, isModalSubmit: () => false, reply: vi.fn(async () => {}), showModal } as any);
    expect(showModal).toHaveBeenCalledTimes(1);
    expect((showModal.mock.calls[0] as unknown[])[0]).toMatchObject({ custom_id: "report:answer" });
  });

  it("files the same issue a 👎 would, with the question, the note and the answer", async () => {
    const report = vi.fn(async (_r: any) => ({ ok: true as const, number: 7, url: "https://github.com/ZOGWORK/control-scout/issues/7" }));
    const rememberReport = vi.fn(async (_id: string, _issue: { number: number; url: string }) => {});
    const answerRow = vi.fn(async (_id: string) => ({ question: "4215 opr", report: null, source: "bruno", step: "stat", ms: 900 }));
    const h = createHandler(() => {}, lookups({ report, rememberReport, answerRow }));
    const submitted = {
      customId: "report:answer",
      user: { id: "u1", globalName: "Sam" },
      member: null,
      fields: { getTextInputValue: () => "the OPR is wrong" },
      message: { id: "m1", guildId: "g1", channelId: "c1", content: "4215 has 120 OPR", partial: false },
      deferReply: vi.fn(async () => {}),
      editReply: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
      isChatInputCommand: () => false, isAutocomplete: () => false, isButton: () => false,
      isModalSubmit: () => true,
    };
    await h(submitted as any);
    expect(report).toHaveBeenCalledTimes(1);
    const sent = (report.mock.calls[0] as unknown[])[0] as { message: string; note?: string; answer?: { source: string | null } };
    expect(sent.message).toBe("4215 opr");
    expect(sent.note).toBe("the OPR is wrong");
    expect(sent.answer?.source).toBe("bruno");
    expect(rememberReport).toHaveBeenCalledWith("m1", expect.objectContaining({ number: 7, url: "https://github.com/ZOGWORK/control-scout/issues/7" }));
  });

  it("says so when the message isn't one of its answers", async () => {
    const report = vi.fn();
    const h = createHandler(() => {}, lookups({ report, answerRow: async () => null }));
    const reply = vi.fn(async (_p: any) => {});
    await h({ customId: "report:answer", user: { id: "u1" }, isChatInputCommand: () => false, isAutocomplete: () => false, isButton: () => false, isModalSubmit: () => true, fields: { getTextInputValue: () => "x" }, message: { id: "m1" }, reply } as any);
    expect(report).not.toHaveBeenCalled();
    expect(((reply.mock.calls[0] as unknown[])[0] as { content: string }).content).toContain("isn't one of my answers");
  });
});

describe("team autocomplete", () => {
  it("asks for teams on a team option, and events on an event option", async () => {
    const teamChoices = vi.fn(async () => [{ name: "4215 — Alpha", value: "4215" }]);
    const choices = vi.fn(async () => [{ name: "Austin (AUSTIN)", value: "AUSTIN" }]);
    const h = createHandler(() => {}, lookups({ teamChoices, choices }));
    const sent: unknown[] = [];
    const auto = (name: string, value: string) => ({
      commandName: "team", isChatInputCommand: () => false, isAutocomplete: () => true, isButton: () => false,
      options: { getFocused: () => value, getFocusedOption: () => ({ name, value }) },
      respond: async (x: unknown) => { sent.push(x); },
    });
    // Discord's own shape: getFocused(true) gives the focused option, name and all.
    const withFocused = (name: string, value: string) => ({
      ...auto(name, value), options: { getFocused: (all?: boolean) => (all ? { name, value } : value) },
    });
    await h(withFocused("number", "4215") as any);
    expect(teamChoices).toHaveBeenCalledWith("4215");
    await h(withFocused("team", "42") as any);
    expect(teamChoices).toHaveBeenCalledWith("42");
    await h(withFocused("event", "aus") as any);
    expect(choices).toHaveBeenCalledWith("aus");
    expect(sent).toHaveLength(3);
  });
});
