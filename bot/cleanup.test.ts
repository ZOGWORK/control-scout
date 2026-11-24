// The stale 👎 sweep (bot/cleanup.ts): its own reaction off its own answers, a member's and a 👍 left alone, the walk
// back to the thumbs era, pages read as Discord sends them (a Map, not an array), a channel it can't read, a channel it
// stops part-way through and carries on from, archived threads paged to the end, a server it is added back to, and the
// whole thing once — and only once it finished.
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

const sweep = (channels: SweptChannel[], failed = 0, cursors?: Record<string, string>) =>
  sweepStaleThumbs({ me: BOT, channels: async () => ({ channels, failed }), ...(cursors ? { cursors } : {}) });

describe("the stale 👎 sweep", () => {
  it("takes its own 👎 off its own answer, and leaves everything else", async () => {
    const mine = msg("a1", IN_ERA, [reacted("👍", true), reacted(OLD_DOWN, true)]);
    // A member's own 👎 on the same answer, a person's message the bot reacted to, and a 👍 on an answer: all stay.
    const shared = msg("a2", IN_ERA, [reacted(OLD_DOWN, false)]);
    const theirs = msg("p1", IN_ERA, [reacted(OLD_DOWN, true)], false);
    const good = msg("a3", IN_ERA, [reacted("👍", true)]);
    // One removed is the test: the summary counts what was taken off, and nothing else qualified.
    const s = await sweep([channel("c1", [[mine, shared, theirs, good]])]);
    expect(s).toEqual({ channels: 1, messages: 4, removed: 1, failed: 0, cursors: {} });
  });

  it("walks back to the thumbs era and no further", async () => {
    const asked: { limit: number; before?: string }[] = [];
    const first = page(PAGE, IN_ERA, []);
    // The second page holds the answer that still has one, and a message from before the thumbs: the walk ends there.
    const second = [msg("a-old", IN_ERA - PAGE), msg("ancient", BEFORE, [])];
    // A third page exists and must never be read.
    const never = [msg("a-never", BEFORE - 1)];
    const s = await sweep([channel("c1", [first, second, never], asked)]);
    expect(s).toEqual({ channels: 1, messages: PAGE + 2, removed: 1, failed: 0, cursors: {} });
    expect(asked.map((a) => a.limit)).toEqual([PAGE, PAGE]);
    // The walk continues from the oldest message of the page before it.
    expect(asked[1].before).toBe(first[first.length - 1].id);
  });

  it("leaves the place it stopped at, and the next run carries on from there", async () => {
    // A channel with more than one run's worth of messages: twenty full pages, none of them before the thumbs.
    const all = Array.from({ length: PAGES * PAGE }, (_, i) => msg(`m-${i}`, IN_ERA - i, []));
    const pages = Array.from({ length: PAGES }, (_, i) => all.slice(i * PAGE, (i + 1) * PAGE));
    const asked: { limit: number; before?: string }[] = [];
    const busy = await sweep([channel("c1", pages, asked)]);
    expect(asked.length).toBe(PAGES);
    const cursor = busy.cursors.c1;
    expect(cursor).toBe(`m-${PAGES * PAGE - 1}`);
    // The next run starts where that one stopped rather than at the newest message, and finishes the channel.
    const next: { limit: number; before?: string }[] = [];
    const rest = await sweep([channel("c1", [[msg("ancient", BEFORE, [])]], next)], 0, busy.cursors);
    expect(next[0]).toEqual({ limit: PAGE, before: cursor });
    expect(rest).toEqual({ channels: 1, messages: 1, removed: 0, failed: 0, cursors: {} });
  });

  it("a channel it can't read is counted, and the next one is swept", async () => {
    const said: string[] = [];
    const s = await sweepStaleThumbs({ me: BOT, channels: async () => ({
      channels: [channel("closed", [new Error("Missing Permissions")]), channel("open", [[msg("a1", IN_ERA)]])],
      failed: 0,
    }) }, (m) => said.push(m));
    expect(s).toEqual({ channels: 2, messages: 1, removed: 1, failed: 1, cursors: {} });
    expect(said.join("\n")).toContain("closed");
  });

  it("a list of channels that couldn't be read is part of the summary", async () => {
    const s = await sweep([channel("c1", [[msg("a1", IN_ERA)]])], 1);
    expect(s).toEqual({ channels: 1, messages: 1, removed: 1, failed: 1, cursors: {} });
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

  /** A thread with one answer that still carries the 👎. */
  const thread = (id: string) => ({
    id,
    archiveTimestamp: Number(id.slice(1)) * 1000,
    isTextBased: () => true,
    messages: { fetch: async () => new Map([[`${id}-a`, msg(`${id}-a`, IN_ERA)]]) },
  });

  /** A client with one server and one channel holding one stale 👎; `broken` makes listing the channels fail,
   *  `anonymous` leaves the bot's own id unknown, `archivedPages` is how many pages of archived threads there are, and
   *  `reads` counts how often the channel is read. */
  function fake(reads: { n: number }, opts: { broken?: boolean; anonymous?: boolean; archivedPages?: number } = {}): Client {
    let askedArchived = 0;
    const ch = {
      id: "c1",
      isTextBased: () => true,
      threads: {
        fetchArchived: async () => {
          const n = opts.archivedPages ?? 0;
          const page = n > askedArchived ? new Map([[`t${askedArchived + 1}`, thread(`t${askedArchived + 1}`)]]) : new Map();
          askedArchived++;
          return { threads: page, hasMore: askedArchived < n };
        },
      },
      messages: {
        fetch: async () => { reads.n++; return new Map([["a1", msg("a1", IN_ERA)]]); },
      },
    };
    const collection = new Map([["c1", ch]]);
    const guild = {
      id: "g1",
      channels: {
        fetch: opts.broken ? async () => { throw new Error("Missing Access"); } : async () => collection,
        fetchActiveThreads: async () => ({ threads: new Map() }),
      },
    };
    return { user: opts.anonymous ? null : { id: BOT }, guilds: { cache: new Map([["g1", guild]]) } } as unknown as Client;
  }

  it("sweeps the first time, records it, and never reads a channel again", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    const first = await sweepOldThumbs(fake(reads), (m) => said.push(m));
    expect(first).toEqual({ channels: 1, messages: 1, removed: 1, failed: 0, cursors: {} });
    expect(await kvGet<{ done: boolean; removed: number }>(SWEEP_KEY)).toMatchObject({ done: true, removed: 1 });
    expect(reads.n).toBe(1);
    // A restart: the row says it has run, so nothing is asked of Discord at all.
    expect(await sweepOldThumbs(fake(reads), (m) => said.push(m))).toBeNull();
    expect(reads.n).toBe(1);
  });

  it("follows the archived threads to the end of what it can list", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    // Two pages of archived threads, the second the last: the answer in each is cleaned, and the sweep is recorded.
    expect(await sweepOldThumbs(fake(reads, { archivedPages: 2 }), (m) => said.push(m))).toMatchObject({ removed: 3, failed: 0 });
    expect(await kvGet<{ done: boolean }>(SWEEP_KEY)).toMatchObject({ done: true });
  });

  it("sweeps a server it is added back to, once the sweep has run for the others", async () => {
    const reads: string[] = [];
    const guild = (id: string) => ({
      id,
      channels: {
        fetch: async () => new Map([[`${id}-c`, {
          id: `${id}-c`,
          isTextBased: () => true,
          messages: { fetch: async () => { reads.push(id); return new Map([["a1", msg("a1", IN_ERA)]]); } },
        }]]),
        fetchActiveThreads: async () => ({ threads: new Map() }),
      },
    });
    const client = { user: { id: BOT }, guilds: { cache: new Map([["g1", guild("g1")], ["g2", guild("g2")]]) } } as unknown as Client;
    // Before the sweep has run, a join is left to the startup sweep.
    expect(await sweepOldThumbs(client, () => {}, "g2")).toBeNull();
    expect(reads).toEqual([]);
    expect(await sweepOldThumbs(client, () => {})).toMatchObject({ channels: 2, removed: 2 });
    // Added back afterwards: only that server is read, and the row is left as it was.
    const before = await kvGet<{ at: string }>(SWEEP_KEY);
    reads.length = 0;
    expect(await sweepOldThumbs(client, () => {}, "g2")).toMatchObject({ channels: 1, removed: 1 });
    expect(reads).toEqual(["g2"]);
    expect(await kvGet<{ at: string }>(SWEEP_KEY)).toEqual(before);
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
    expect(await kvGet(SWEEP_KEY)).toMatchObject({ done: false });
    expect(said.join("\n")).toContain("g1's channels");
    // The next start tries again, and this time it finishes and is recorded.
    expect(await sweepOldThumbs(fake(reads), (m) => said.push(m))).toMatchObject({ removed: 1, failed: 0 });
    expect(await kvGet<{ done: boolean }>(SWEEP_KEY)).toMatchObject({ done: true });
  });
});
