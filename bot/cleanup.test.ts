// The stale 👎 sweep (bot/cleanup.ts): its own reaction off its own answers, a member's and a 👍 left alone, the walk
// back to the thumbs era, pages read as Discord sends them (a Map, not an array), a channel it can't read, a channel
// with more history than the walk reaches, and the whole thing once — and only once it finished.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "discord.js";
import { kvGet, migrate, openDb, run, setDb } from "../server/db";
import { OLD_DOWN, PAGE, PAGES, SWEEP_KEY, THUMBS_FROM, sweepOldThumbs, sweepStaleThumbs, type SweptChannel, type SweptMessage, type SweptReaction } from "./cleanup";

const BOT = "bot-1";
const someone = "person-1";
/** A moment inside the thumbs era. */
const IN_ERA = THUMBS_FROM + 86_400_000;
/** Before any answer could carry one. */
const BEFORE = THUMBS_FROM - 86_400_000;

/** One reaction on a message. */
const reacted = (emoji: string, me: boolean): SweptReaction => ({ emoji: { name: emoji }, me, users: { remove: async () => ({ ok: true }) } });

/** One message: the bot's own (`mine`) unless told otherwise. */
const msg = (id: string, at: number, reactions: SweptReaction[] = [], mine = true): SweptMessage => ({
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
const page = (n: number, start = IN_ERA, reactions: SweptReaction[] = []) =>
  Array.from({ length: n }, (_, i) => msg(`m-${start + i}`, start - i, reactions));

const sweep = (channels: SweptChannel[], failed = 0, capped = 0) =>
  sweepStaleThumbs({ me: BOT, channels: async () => ({ channels, failed, capped }) });

describe("the stale 👎 sweep", () => {
  it("takes its own 👎 off its own answer, and leaves everything else", async () => {
    const mine = msg("a1", IN_ERA, [reacted("👍", true), reacted(OLD_DOWN, true)]);
    // A member's own 👎 on the same answer, a person's message the bot reacted to, and a 👍 on an answer: all stay.
    const shared = msg("a2", IN_ERA, [reacted(OLD_DOWN, false)]);
    const theirs = msg("p1", IN_ERA, [reacted(OLD_DOWN, true)], false);
    const good = msg("a3", IN_ERA, [reacted("👍", true)]);
    // One removed is the test: the summary counts what was taken off, and nothing else qualified.
    const s = await sweep([channel("c1", [[mine, shared, theirs, good]])]);
    expect(s).toEqual({ channels: 1, messages: 4, removed: 1, failed: 0, capped: 0 });
  });

  it("walks back to the thumbs era and no further", async () => {
    const asked: { limit: number; before?: string }[] = [];
    const first = page(PAGE);
    // The second page holds the answer that still has one, and a message from before the thumbs: the walk ends there.
    const second = [msg("a-old", IN_ERA - PAGE, [reacted(OLD_DOWN, true)]), msg("ancient", BEFORE)];
    // A third page exists and must never be read.
    const never = [msg("a-never", BEFORE - 1, [reacted(OLD_DOWN, true)])];
    const s = await sweep([channel("c1", [first, second, never], asked)]);
    expect(s).toEqual({ channels: 1, messages: PAGE + 2, removed: 1, failed: 0, capped: 0 });
    expect(asked.map((a) => a.limit)).toEqual([PAGE, PAGE]);
    // The walk continues from the oldest message of the page before it.
    expect(asked[1].before).toBe(first[first.length - 1].id);
  });

  it("stops at its page cap, and says the channel wasn't finished", async () => {
    const asked: { limit: number; before?: string }[] = [];
    const pages = Array.from({ length: PAGES + 3 }, () => page(PAGE));
    const s = await sweep([channel("c1", pages, asked)]);
    expect(asked.length).toBe(PAGES);
    expect(s.messages).toBe(PAGES * PAGE);
    expect(s).toMatchObject({ removed: 0, failed: 0, capped: 1 });
  });

  it("a channel it can't read is counted, and the next one is swept", async () => {
    const said: string[] = [];
    const s = await sweepStaleThumbs({ me: BOT, channels: async () => ({
      channels: [channel("closed", [new Error("Missing Permissions")]), channel("open", [[msg("a1", IN_ERA, [reacted(OLD_DOWN, true)])]])],
      failed: 0,
      capped: 0,
    }) }, (m) => said.push(m));
    expect(s).toEqual({ channels: 2, messages: 1, removed: 1, failed: 1, capped: 0 });
    expect(said.join("\n")).toContain("closed");
  });

  it("a list of channels that couldn't be read is part of the summary", async () => {
    const s = await sweep([channel("c1", [[msg("a1", IN_ERA, [reacted(OLD_DOWN, true)])]])], 1);
    expect(s).toEqual({ channels: 1, messages: 1, removed: 1, failed: 1, capped: 0 });
  });
});

describe("the sweep runs once it finished", () => {
  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
  });
  beforeEach(async () => {
    await run("DELETE FROM kv WHERE key = ?", [SWEEP_KEY]);
  });

  /** A client with one server and one channel holding one stale 👎; `broken` makes listing the channels fail,
   *  `archivedMore` makes the archived-thread listing full, `anonymous` leaves the bot's own id unknown, and `reads`
   *  counts how often the channel is read. */
  function fake(reads: { n: number }, opts: { broken?: boolean; archivedMore?: boolean; anonymous?: boolean } = {}): Client {
    const threads = () => ({ threads: new Map(), hasMore: !!opts.archivedMore });
    const ch = {
      id: "c1",
      isTextBased: () => true,
      threads: { fetchArchived: async () => threads() },
      messages: {
        fetch: async () => { reads.n++; return new Map([["a1", msg("a1", IN_ERA, [reacted(OLD_DOWN, true)])]]); },
      },
    };
    const collection = new Map([["c1", ch]]);
    const guild = {
      id: "g1",
      channels: {
        fetch: opts.broken ? async () => { throw new Error("Missing Access"); } : async () => collection,
        fetchActiveThreads: async () => threads(),
      },
    };
    return { user: opts.anonymous ? null : { id: BOT }, guilds: { cache: new Map([["g1", guild]]) } } as unknown as Client;
  }

  it("sweeps the first time, records it, and never reads a channel again", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    const first = await sweepOldThumbs(fake(reads), (m) => said.push(m));
    expect(first).toEqual({ channels: 1, messages: 1, removed: 1, failed: 0, capped: 0 });
    expect(await kvGet<{ done: boolean; removed: number }>(SWEEP_KEY)).toMatchObject({ done: true, removed: 1 });
    expect(reads.n).toBe(1);
    // A restart: the row says it has run, so nothing is asked of Discord at all.
    expect(await sweepOldThumbs(fake(reads), (m) => said.push(m))).toBeNull();
    expect(reads.n).toBe(1);
  });

  it("doesn't record a walk that couldn't list all the archived threads", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    expect(await sweepOldThumbs(fake(reads, { archivedMore: true }), (m) => said.push(m))).toMatchObject({ removed: 1, capped: 1 });
    expect(await kvGet(SWEEP_KEY)).toBeNull();
    expect(said.join("\n")).toContain("more threads than this walk reads");
  });

  it("doesn't sweep without the bot's own id: nothing could match, so nothing is recorded", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    expect(await sweepOldThumbs(fake(reads, { anonymous: true }), (m) => said.push(m))).toBeNull();
    expect(reads.n).toBe(0);
    expect(await kvGet(SWEEP_KEY)).toBeNull();
    expect(said.join("\n")).toContain("own id isn't known");
  });

  it("doesn't record a sweep whose channel list couldn't be read: the next start looks again", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    const partial = await sweepOldThumbs(fake(reads, { broken: true }), (m) => said.push(m));
    expect(partial).toMatchObject({ channels: 0, removed: 0, failed: 1 });
    expect(await kvGet(SWEEP_KEY)).toBeNull();
    expect(said.join("\n")).toContain("g1's channels");
    // The next start tries again, and this time it finishes and is recorded.
    expect(await sweepOldThumbs(fake(reads), (m) => said.push(m))).toMatchObject({ removed: 1, failed: 0 });
    expect(await kvGet<{ done: boolean }>(SWEEP_KEY)).toMatchObject({ done: true });
  });
});
