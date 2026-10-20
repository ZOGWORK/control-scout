// The interaction handler with stand-in interactions: deferred replies, the shared cache, the
// per-person cooldown, and friendly errors for every failure (never the exception's words).
import { describe, expect, it, vi } from "vitest";
import type { APIEmbed } from "discord.js";
import { createHandler, type Lookups } from "./handler";
import { Friendly } from "./views";
import { AnswerCache, Cooldown } from "./guard";
import { COMMANDS, sameCommands } from "./commands";

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
    ...over,
  };
}

describe("commands", () => {
  it("defers, then answers with the lookup's embed", async () => {
    const h = createHandler(() => {}, lookups(), { cooldownMs: 0 });
    const { i, calls } = command("team", { number: 18360 });
    await h(i);
    expect(calls.map((c) => c.kind)).toEqual(["defer", "edit"]);
    expect(calls[1].payload.embeds[0].title).toBe("team 18360");
  });

  it("the same command and arguments within a minute cost one lookup, whoever asks", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l, { cooldownMs: 0 });
    await Promise.all(["a", "b", "c"].map((u) => h(command("predict", { event: "ustxauq", match: 3 }, u).i)));
    await h(command("predict", { event: "USTXAUQ", match: 3 }, "d").i);
    expect(l.predict).toHaveBeenCalledTimes(1);
  });

  it("one command per person every 3 seconds: the second gets a private 'slow down'", async () => {
    const l = lookups();
    const h = createHandler(() => {}, l);
    await h(command("team", { number: 1 }).i);
    const { i, calls } = command("team", { number: 2 });
    await h(i);
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("reply");
    expect(calls[0].payload.embeds[0].title).toBe("Slow down");
    expect(calls[0].payload.flags).toBe(64); // ephemeral
    expect(l.team).toHaveBeenCalledTimes(1);
  });

  it("a friendly error is shown as is and not logged", async () => {
    const log = vi.fn();
    const h = createHandler(log, lookups({ team: async () => { throw new Friendly("Team not found", "No team 9."); } }), { cooldownMs: 0 });
    const { i, calls } = command("team", { number: 9 });
    await h(i);
    expect(calls[1].payload.embeds[0]).toMatchObject({ title: "Team not found", description: "No team 9." });
    expect(log).not.toHaveBeenCalled();
  });

  it("the database being down: a friendly embed, the details only in the log, and the next ask tries again", async () => {
    const log = vi.fn();
    let fail = true;
    const l = lookups({ event: vi.fn(async (c: string) => { if (fail) throw new Error("SQLITE_BUSY: database is locked"); return ok(c); }) });
    const h = createHandler(log, l, { cooldownMs: 0 });
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
    const h = createHandler(log, lookups(), { cooldownMs: 0 });
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

describe("Cooldown", () => {
  it("waits out the rest of 3 seconds, per person", () => {
    const c = new Cooldown(3000);
    expect(c.take("a", 0)).toBe(0);
    expect(c.take("a", 1000)).toBe(2000);
    expect(c.take("b", 1000)).toBe(0);
    expect(c.take("a", 3000)).toBe(0);
  });
});

describe("registration", () => {
  it("exactly four commands", () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(["team", "predict", "event", "rankings"]);
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
