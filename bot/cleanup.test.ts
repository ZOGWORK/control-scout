// The stale 👎 sweep (bot/cleanup.ts): its own 👎 off its own answers and nothing else, the walk back to the thumbs era,
// pages read as Discord sends them (a Map, not an array), a channel it can't read, a page that won't move, a 👎 that is
// already gone, the whole thing once — and only once it finished — one server's pass when it is added back, and one sweep
// at a time.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "discord.js";
import { kvGet, migrate, openDb, run, setDb } from "../server/db";
import { OLD_DOWN, PAGE, THUMBS_FROM, sweepKey, sweepOldThumbs, sweepStaleThumbs, type SweptChannel, type SweptMessage, type SweptReaction } from "./cleanup";

const BOT = "bot-1";
const someone = "person-1";
/** A moment inside the thumbs era. */
const IN_ERA = THUMBS_FROM + 86_400_000;
/** Before any answer could carry one. */
const BEFORE = THUMBS_FROM - 86_400_000;

/** One reaction on a message: `gone` collects the emoji of each one that is taken off, and `fails` is what Discord says
 *  when the reaction is already gone. */
const reacted = (emoji: string, me: boolean, gone: string[] = [], fails?: Error): SweptReaction => ({
  emoji: { name: emoji },
  me,
  users: { remove: async () => { if (fails) throw fails; gone.push(emoji); return { ok: true }; } },
});

/** One message: the bot's own (`mine`) unless told otherwise, with one stale 👎 by default. */
const msg = (id: string, at: number, reactions: SweptReaction[] = [reacted(OLD_DOWN, true)], mine = true): SweptMessage => ({
  id,
  createdTimestamp: at,
  author: { id: mine ? BOT : someone },
  reactions: { cache: { values: () => reactions[Symbol.iterator]() } },
});

/** A channel whose pages are handed out in order; a page that is an Error is a fetch that failed. Each page is a `Map`
 *  of id → message, as Discord's `Collection` is, so code that spreads the page instead of its values reads nothing. */
function channel(id: string, pages: (SweptMessage[] | Error)[], asked: { limit: number; before?: string }[] = []): SweptChannel {
  const queue = [...pages];
  return {
    id,
    messages: {
      fetch: async (o) => {
        asked.push(o);
        const page = queue.shift() ?? [];
        if (page instanceof Error) throw page;
        return new Map(page.map((m) => [m.id, m]));
      },
    },
  };
}

/** A page of `n` messages the bot posted, newest first, each just older than the one before it. */
const page = (n: number, start = IN_ERA, reactions?: SweptReaction[]) =>
  Array.from({ length: n }, (_, i) => msg(`m-${start + i}`, start - i, reactions));

const sweep = (channels: SweptChannel[], unreadable = 0) =>
  sweepStaleThumbs({ me: BOT, channels: async () => ({ channels, unreadable }) });

describe("the stale 👎 sweep", () => {
  it("takes its own 👎 off its own answer, and nothing else", async () => {
    const gone: string[] = [];
    const mine = msg("a1", IN_ERA, [reacted("👍", true, gone), reacted(OLD_DOWN, true, gone)]);
    // A member's own 👎 on the same answer, a person's message the bot reacted to, and a 👍 on an answer: all stay.
    const shared = msg("a2", IN_ERA, [reacted(OLD_DOWN, false, gone)]);
    const theirs = msg("p1", IN_ERA, [reacted(OLD_DOWN, true, gone)], false);
    const good = msg("a3", IN_ERA, [reacted("👍", true, gone)]);
    const s = await sweep([channel("c1", [[mine, shared, theirs, good]])]);
    // Exactly the bot's 👎 on its own answer, never the 👍 beside it.
    expect(gone).toEqual([OLD_DOWN]);
    expect(s).toEqual({ channels: 1, messages: 4, removed: 1, failed: 0 });
  });

  it("walks back to the thumbs era and no further", async () => {
    const asked: { limit: number; before?: string }[] = [];
    const gone: string[] = [];
    const first = page(PAGE, IN_ERA, []);
    // A full page: the answer that still has one, then messages in the era, and a message from before the thumbs at the
    // end. The page is full, so a short page can't be what ends the walk — the era cutoff is.
    const second = [msg("a-old", IN_ERA - PAGE, [reacted(OLD_DOWN, true, gone)]), ...page(PAGE - 2, IN_ERA - PAGE - 100, []), msg("ancient", BEFORE, [])];
    expect(second).toHaveLength(PAGE);
    // A third page exists and must never be read: without the cutoff the walk would ask for it.
    const never = [msg("a-never", BEFORE - 1)];
    const s = await sweep([channel("c1", [first, second, never], asked)]);
    expect(gone).toEqual([OLD_DOWN]);
    expect(s).toEqual({ channels: 1, messages: PAGE * 2, removed: 1, failed: 0 });
    expect(asked.map((a) => a.limit)).toEqual([PAGE, PAGE]);
    // The walk continues from the oldest message of the page before it.
    expect(asked[1].before).toBe(first[first.length - 1].id);
  });

  it("a channel it can't read is counted, and the next one is swept", async () => {
    const said: string[] = [];
    const gone: string[] = [];
    const s = await sweepStaleThumbs({ me: BOT, channels: async () => ({
      channels: [channel("closed", [Object.assign(new Error("Missing Permissions"), { code: 50001 })]), channel("open", [[msg("a1", IN_ERA, [reacted(OLD_DOWN, true, gone)])]])],
      unreadable: 0,
    }) }, (m) => said.push(m));
    expect(s).toEqual({ channels: 2, messages: 1, removed: 1, failed: 1 });
    expect(gone).toEqual([OLD_DOWN]);
    // A server that added the bot before this release: the log says what fixes it.
    expect(said.join("\n")).toContain("Read Message History");
  });

  it("a list of channels that couldn't be read is counted", async () => {
    const s = await sweep([channel("c1", [[msg("a1", IN_ERA)]])], 1);
    expect(s).toEqual({ channels: 1, messages: 1, removed: 1, failed: 1 });
  });

  it("a page that won't move backwards is left unfinished rather than looping", async () => {
    const asked: { limit: number; before?: string }[] = [];
    // Full pages that always hold the same message: the walk asks to go before it and gets it again.
    const stuck = page(PAGE, IN_ERA, []);
    const s = await sweep([channel("c1", Array.from({ length: 5 }, () => stuck), asked)]);
    // It stops on the second page instead of asking for the same one forever.
    expect(asked.length).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.messages).toBe(PAGE * 2);
  });

  it("a 👎 that is already gone is not a failure", async () => {
    const already = msg("a1", IN_ERA, [reacted(OLD_DOWN, true, [], Object.assign(new Error("Unknown Emoji"), { code: 10014 }))]);
    const s = await sweep([channel("c1", [[already]])]);
    expect(s).toEqual({ channels: 1, messages: 1, removed: 0, failed: 0 });
  });
});

describe("the sweep runs once a server finished", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM kv WHERE key LIKE 'bot:down-sweep%'");
  });

  /** One server with one channel: each read is recorded in `reads`, `broken` makes listing its channels fail, and `gate`
   *  holds the read until it is opened (so two sweeps' order can be seen). */
  function guild(id: string, reads: string[], opts: { broken?: boolean; gate?: Promise<void> } = {}) {
    const ch = {
      id: `${id}-c`,
      isTextBased: () => true,
      messages: { fetch: async () => { reads.push(id); if (opts.gate) await opts.gate; return new Map([["a1", msg("a1", IN_ERA)]]); } },
    };
    return {
      id,
      channels: {
        fetch: opts.broken ? async () => { throw new Error("Missing Access"); } : async () => new Map([[ch.id, ch]]),
        fetchActiveThreads: async () => ({ threads: new Map() }),
      },
    };
  }

  const client = (guilds: ReturnType<typeof guild>[], anonymous = false): Client =>
    ({ user: anonymous ? null : { id: BOT }, guilds: { cache: new Map(guilds.map((g) => [g.id, g])) } } as unknown as Client);

  it("sweeps the first time, records it, and never reads a channel again", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    const first = await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m));
    expect(first).toEqual({ channels: 1, messages: 1, removed: 1, failed: 0 });
    expect(await kvGet<{ at: string; removed: number }>(sweepKey("g1"))).toMatchObject({ removed: 1 });
    expect(reads).toEqual(["g1"]);
    // A restart: its row says it has run, so nothing is asked of Discord at all.
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toBeNull();
    expect(reads).toEqual(["g1"]);
  });

  it("walks a server with no row of its own, even when the others are done", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1 });
    reads.length = 0;
    // Added while the process was down: no GuildCreate happened, so the start is the only chance to walk it.
    expect(await sweepOldThumbs(client([guild("g1", reads), guild("g3", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1 });
    expect(reads).toEqual(["g3"]);
    expect(await kvGet(sweepKey("g3"))).not.toBeNull();
  });

  it("sweeps only the server added back, and leaves the row it was given", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1 });
    const row = await kvGet(sweepKey("g1"));
    reads.length = 0;
    // Added back later: its own answers are still there, so that server is walked then — and no other.
    expect(await sweepOldThumbs(client([guild("g1", reads), guild("g2", reads)]), (m) => said.push(m), { only: "g2" }))
      .toMatchObject({ channels: 1, removed: 1, failed: 0 });
    expect(reads).toEqual(["g2"]);
    expect(await kvGet(sweepKey("g1"))).toEqual(row);
    expect(await kvGet(sweepKey("g2"))).not.toBeNull();
  });

  it("a pass that missed something in the added-back server leaves it for the next start", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1 });
    expect(await kvGet(sweepKey("g1"))).not.toBeNull();
    const partial = await sweepOldThumbs(client([guild("g2", reads, { broken: true })]), (m) => said.push(m), { only: "g2" });
    expect(partial).toMatchObject({ channels: 0, failed: 1 });
    // It has no row, so the next start walks it again — and not the server that finished.
    expect(await kvGet(sweepKey("g2"))).toBeNull();
    reads.length = 0;
    expect(await sweepOldThumbs(client([guild("g1", reads), guild("g2", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1, removed: 1 });
    expect(reads).toEqual(["g2"]);
  });

  it("runs one sweep at a time, so a join can't walk over a pass in flight", async () => {
    const reads: string[] = [];
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    const said: string[] = [];
    const both = client([guild("g1", reads, { gate }), guild("g2", reads)]);
    const startup = sweepOldThumbs(both, (m) => said.push(m));
    // The join's pass queues behind the one already walking, rather than reading at the same time.
    const join = sweepOldThumbs(both, (m) => said.push(m), { only: "g2" });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads).toEqual(["g1"]);
    open();
    await Promise.all([startup, join]);
    // The startup pass walks both servers, then the join's pass walks its own.
    expect(reads).toEqual(["g1", "g2", "g2"]);
  });

  it("doesn't record a sweep that missed something, and the next start tries again", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    const partial = await sweepOldThumbs(client([guild("g1", reads, { broken: true })]), (m) => said.push(m));
    expect(partial).toMatchObject({ channels: 0, removed: 0, failed: 1 });
    expect(await kvGet(sweepKey("g1"))).toBeNull();
    expect(said.join("\n")).toContain("g1's channels");
    // The next start tries again, and this time it finishes and is recorded.
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ removed: 1, failed: 0 });
    expect(await kvGet(sweepKey("g1"))).not.toBeNull();
  });

  it("leaves a channel it can't see out of the walk, so it can't keep the sweep unfinished", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    /** A channel the bot can read, one it can't see, and a thread it can't see: only the first is walked. */
    const reader = (id: string, seen: boolean) => ({
      id,
      isTextBased: () => true,
      viewable: seen,
      messages: { fetch: async () => { reads.push(id); return new Map([["a1", msg("a1", IN_ERA)]]); } },
    });
    const client = {
      user: { id: BOT },
      guilds: { cache: new Map([["g1", { id: "g1", channels: {
        fetch: async () => new Map([["open", reader("open", true)], ["private", reader("private", false)]]),
        fetchActiveThreads: async () => ({ threads: new Map([["t", reader("t", false)]]) }),
      } }]]) },
    } as unknown as Client;
    expect(await sweepOldThumbs(client, (m) => said.push(m))).toMatchObject({ channels: 1, removed: 1, failed: 0 });
    expect(reads).toEqual(["open"]);
    expect(await kvGet(sweepKey("g1"))).not.toBeNull();
  });

  it("doesn't sweep without the bot's own id: nothing could match, so nothing is recorded", async () => {
    const reads: string[] = [];
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)], true), (m) => said.push(m))).toBeNull();
    expect(reads).toEqual([]);
    expect(await kvGet(sweepKey("g1"))).toBeNull();
    expect(said.join("\n")).toContain("own id isn't known");
  });
});
