// What a mention asks the bot to do (bot/actions.ts) and what the handler does with it: the audit's Q51–53 and Q90,
// where "follow 4215", "watch the next event 4215 is in", "remind me when 4215 plays next" and "remember that my team
// is 4215" were answered by the chat, which can only talk ("Got it, I'll remember your team is 4215!" kept nothing).
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { mentionsMine, parseAction, withMyTeam } from "./actions";
import { createHandler, type Lookups, type MentionMessage } from "./handler";

describe("parseAction", () => {
  it("reads the audit's own requests", () => {
    expect(parseAction("follow 4215 and tell me when they play next")).toEqual({ kind: "follow", team: 4215, rest: "when they play next" });
    expect(parseAction("watch the next event 4215 is in")).toEqual({ kind: "watchEvent", team: 4215, event: null, rest: "" });
    expect(parseAction("remind me when 4215 plays next")).toEqual({ kind: "remind", team: 4215, rest: "" });
    expect(parseAction("remember that my team is 4215")).toEqual({ kind: "myTeam", team: 4215, rest: "" });
  });

  it("reads the other ways people say them", () => {
    expect(parseAction("can you please follow team 6980 here")).toMatchObject({ kind: "follow", team: 6980 });
    expect(parseAction("watch 4215's next event")).toMatchObject({ kind: "watchEvent", team: 4215 });
    expect(parseAction("follow event USNJCMP")).toMatchObject({ kind: "watchEvent", team: null, event: "USNJCMP" });
    expect(parseAction("ping me before 23314's next match")).toMatchObject({ kind: "remind", team: 23314 });
    expect(parseAction("remind me about 4215")).toMatchObject({ kind: "remind", team: 4215 });
    expect(parseAction("stop reminding me about 4215")).toMatchObject({ kind: "cancelRemind", team: 4215 });
    expect(parseAction("cancel my reminders")).toMatchObject({ kind: "cancelRemind", team: null });
    expect(parseAction("unfollow 4215")).toMatchObject({ kind: "unfollow", team: 4215 });
    expect(parseAction("my team is 4215")).toMatchObject({ kind: "myTeam", team: 4215 });
    expect(parseAction("we're team 30030, how did we do at worlds")).toEqual({ kind: "myTeam", team: 30030, rest: "how did we do at worlds" });
    expect(parseAction("I'm on 4215")).toMatchObject({ kind: "myTeam", team: 4215 });
    expect(parseAction("forget my team")).toMatchObject({ kind: "forgetMyTeam" });
  });

  it("leaves questions alone, including ones with those words inside them", () => {
    for (const q of [
      "what is 4215's opr",
      "how many teams follow 4215's lead",
      "who should i watch at the next nj meet and why",
      "compare 4215 and 23314 and tell me which one to watch at their next event",
      "did 4215 follow up with a win",
      "follow the leader 2025",
      "what was my team's record",
      // A sentence that starts like "we're <number>" but isn't a team (Loopy, #2386).
      "we are 10 minutes from our match, who plays next",
      "we're 12 points behind 6980 in auto",
      "i'm on 3 hours of sleep, who won decode",
    ]) expect(parseAction(q), q).toBeNull();
    expect(parseAction("we are 4215.")).toMatchObject({ kind: "myTeam", team: 4215 });
    expect(parseAction("i'm on team 23314 and who is our next opponent")).toMatchObject({ kind: "myTeam", team: 23314, rest: "who is our next opponent" });
  });
});

describe("my team", () => {
  it("is read into a question that leans on it, and nothing else", () => {
    expect(withMyTeam("how did my team do at their last event", 4215)).toBe("how did 4215 do at their last event");
    expect(withMyTeam("what's our opr this season", 4215)).toBe("what's 4215's opr this season");
    expect(withMyTeam("how did we do at nj states", 4215)).toBe("how did 4215 do at nj states");
    expect(withMyTeam("what is my team's record", 4215)).toBe("what is 4215's record");
    expect(withMyTeam("how did my team do", null)).toBe("how did my team do");
    expect(mentionsMine("how did my team do")).toBe(true);
    expect(mentionsMine("what is 6980's opr")).toBe(false);
  });
});

const BOT = "1";
const ok = (title: string): APIEmbed => ({ title });
function lookups(over: Partial<Lookups> = {}): Lookups {
  return {
    team: vi.fn(async () => ok("team")), next: vi.fn(async () => ok("next")), predict: vi.fn(async () => ok("p")),
    event: vi.fn(async () => ok("e")), rankings: vi.fn(async () => ok("r")), choices: vi.fn(async () => []),
    follow: vi.fn(async () => "added" as const), unfollow: vi.fn(async () => 1), following: vi.fn(async () => ok("f")),
    ask: vi.fn(async (q: string) => ({ embed: ok(`ask ${q}`), meta: { step: "deterministic" as const, refined: false, sentence: false } })),
    ...over,
  };
}
function msg(content: string, manager = false) {
  const sent: APIEmbed[] = [];
  const m: MentionMessage = {
    author: { id: "u1", bot: false }, guildId: "g1", channelId: "c1", content,
    member: { displayName: "Sushil", permissions: { has: () => manager } },
    reply: vi.fn(async (o) => { sent.push(...o.embeds); }),
    channel: { send: vi.fn(async () => {}), sendTyping: vi.fn(async () => {}) },
  };
  return { m, sent };
}

describe("a mention that asks for an action", () => {
  it("follows a team for a manager, with the same code as /follow, then answers the rest of the message", async () => {
    const l = lookups();
    const { m, sent } = msg(`<@${BOT}> follow 4215 and tell me when they play next`, true);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(l.follow).toHaveBeenCalledWith("g1", "c1", { kind: "team", team: 4215 }, "u1");
    expect(sent[0].title).toBe("Following 4215");
    // The rest is asked about the action's team, not "they".
    expect(l.ask).toHaveBeenCalledWith("when 4215 play next", [], expect.any(Array), "g1", null);
  });

  it("says plainly that a follow needs Manage Server, and offers the person's own reminder", async () => {
    const l = lookups();
    const { m, sent } = msg(`<@${BOT}> follow 4215`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(l.follow).not.toHaveBeenCalled();
    expect(sent[0].title).toBe("That needs Manage Server");
    expect(sent[0].description).toContain("remind me when 4215 plays next");
    expect(l.ask).not.toHaveBeenCalled();
  });

  it("watches the team's next event, or the team when it's entered in none yet", async () => {
    const l = lookups({ nextEvent: vi.fn(async () => ({ code: "USNJCMP", name: "New Jersey Championship", start: "2027-02-20" })) });
    const { m, sent } = msg(`<@${BOT}> watch the next event 4215 is in`, true);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(l.follow).toHaveBeenCalledWith("g1", "c1", { kind: "event", event: "USNJCMP" }, "u1");
    expect(sent[0].title).toBe("Following New Jersey Championship");
    const none = lookups({ nextEvent: vi.fn(async () => null) });
    const second = msg(`<@${BOT}> watch the next event 4215 is in`, true);
    await createHandler(() => {}, none).mention(second.m, BOT);
    expect(none.follow).toHaveBeenCalledWith("g1", "c1", { kind: "team", team: 4215 }, "u1");
    expect(second.sent[0].description).toContain("isn't entered in an upcoming event yet");
  });

  it("sets a reminder for anyone, saying the match it's for, or that none is scheduled yet", async () => {
    const remind = vi.fn(async () => {});
    const l = lookups({
      remind, nextEvent: vi.fn(async () => null),
      nextMatch: vi.fn(async () => ({ event: { event: { name: "Northeast League Meet" } }, match: { label: "Q12", startsAt: "2026-12-05T15:30:00Z" } }) as never),
    });
    const { m, sent } = msg(`<@${BOT}> remind me when 4215 plays next`);
    await createHandler(() => {}, l).mention(m, BOT);
    expect(remind).toHaveBeenCalledWith("g1", "c1", "u1", 4215);
    expect(sent[0].title).toBe("Reminder set for 4215");
    expect(sent[0].description).toContain("Q12 at Northeast League Meet");
    const later = lookups({ remind: vi.fn(async () => {}), nextEvent: vi.fn(async () => null), nextMatch: vi.fn(async () => null) });
    const second = msg(`<@${BOT}> remind me when 4215 plays next`);
    await createHandler(() => {}, later).mention(second.m, BOT);
    expect(second.sent[0].description).toContain("No match is scheduled for 4215 yet");
    // No such team: said, and nothing kept.
    const unknown = lookups({ remind: vi.fn(async () => {}), nextEvent: vi.fn(async () => "unknown" as const) });
    const third = msg(`<@${BOT}> remind me when 99999 plays next`);
    await createHandler(() => {}, unknown).mention(third.m, BOT);
    expect(third.sent[0].title).toBe("Team not found");
    expect(unknown.remind).not.toHaveBeenCalled();
  });

  it("remembers a person's team, and reads \"my team\" as it from then on", async () => {
    let kept: number | null = null;
    const memory = {
      recall: async () => ({ teams: [], name: null }), learn: async () => {}, thread: async () => [], keep: async () => {},
      channel: async () => null, keepChannel: async () => {},
      myTeam: async () => kept, setMyTeam: vi.fn(async (_g: string, _u: string, _n: string | null, t: number | null) => { kept = t; }),
    };
    const l = lookups({ memory });
    const h = createHandler(() => {}, l);
    const first = msg(`<@${BOT}> remember that my team is 4215`);
    await h.mention(first.m, BOT);
    expect(first.sent[0].title).toBe("Got it: your team is 4215");
    expect(kept).toBe(4215);
    await h.mention(msg(`<@${BOT}> how did my team do`).m, BOT);
    const [q, , lines] = (l.ask as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(q).toBe("how did 4215 do");
    expect(lines.join("\n")).toContain("their own team is 4215");
  });
});
