// The stale 👎 sweep (bot/cleanup.ts): its own reaction off its own answers, a member's and a 👍 left alone, the walk back
// to the thumbs era, pages read as Discord sends them (a Map, not an array), a channel it can't read, archived threads
// paged to the end, a server recorded only when it finished, a server added back later, and the whole thing once per
// server.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Client } from "discord.js";
import { kvGet, migrate, openDb, run, setDb } from "../server/db";
import { OLD_DOWN, PAGE, SWEEP_KEY, THUMBS_FROM, sweepOldThumbs, sweepStaleThumbs, type SweptChannel, type SweptMessage, type SweptReaction } from "./cleanup";

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
function channel(id: string, pages: (SweptMessage[] | Error)[], asked: { limit: number; before?: string }[] = [], guild = "g1"): SweptChannel {
  const queue = [...pages];
  return {
    id,
    guild,
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

const sweep = (channels: SweptChannel[], bad: string[] = []) =>
  sweepStaleThumbs({ me: BOT, channels: async () => ({ channels, bad: new Set(bad) }) });

describe("the stale 👎 sweep", () => {
  it("takes its own 👎 off its own answer, and leaves everything else", async () => {
    const mine = msg("a1", IN_ERA, [reacted("👍", true), reacted(OLD_DOWN, true)]);
    // A member's own 👎 on the same answer, a person's message the bot reacted to, and a 👍 on an answer: all stay.
    const shared = msg("a2", IN_ERA, [reacted(OLD_DOWN, false)]);
    const theirs = msg("p1", IN_ERA, [reacted(OLD_DOWN, true)], false);
    const good = msg("a3", IN_ERA, [reacted("👍", true)]);
    // One removed is the test: the summary counts what was taken off, and nothing else qualified.
    const s = await sweep([channel("c1", [[mine, shared, theirs, good]])]);
    expect(s).toEqual({ channels: 1, messages: 4, removed: 1, bad: new Set() });
  });

  it("walks back to the thumbs era and no further", async () => {
    const asked: { limit: number; before?: string }[] = [];
    const first = page(PAGE, IN_ERA, []);
    // The second page holds the answer that still has one, and a message from before the thumbs: the walk ends there.
    const second = [msg("a-old", IN_ERA - PAGE), msg("ancient", BEFORE, [])];
    // A third page exists and must never be read.
    const never = [msg("a-never", BEFORE - 1)];
    const s = await sweep([channel("c1", [first, second, never], asked)]);
    expect(s).toEqual({ channels: 1, messages: PAGE + 2, removed: 1, bad: new Set() });
    expect(asked.map((a) => a.limit)).toEqual([PAGE, PAGE]);
    // The walk continues from the oldest message of the page before it.
    expect(asked[1].before).toBe(first[first.length - 1].id);
  });

  it("a channel it can't read leaves its server unfinished, and the next one is swept", async () => {
    const said: string[] = [];
    const s = await sweepStaleThumbs({ me: BOT, channels: async () => ({
      channels: [channel("closed", [Object.assign(new Error("Missing Permissions"), { code: 50001 })]), channel("open", [[msg("a1", IN_ERA)]])],
      bad: new Set<string>(),
    }) }, (m) => said.push(m));
    expect(s).toEqual({ channels: 2, messages: 1, removed: 1, bad: new Set(["g1"]) });
    expect(said.join("\n")).toContain("closed");
    // A server that added the bot before this release: the log says what fixes it.
    expect(said.join("\n")).toContain("Read Message History");
  });

  it("a list of channels that couldn't be read leaves its server unfinished", async () => {
    const s = await sweep([channel("c1", [[msg("a1", IN_ERA)]])], ["g1"]);
    expect(s).toEqual({ channels: 1, messages: 1, removed: 1, bad: new Set(["g1"]) });
  });
});

describe("the sweep runs once per server", () => {
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

  /** One server with one channel holding one stale 👎. `broken` makes listing its channels fail, `archivedPages` is how
   *  many pages of archived threads it has, and `reads` counts how often its channel is read. */
  function guild(id: string, reads: { n: number }, opts: { broken?: boolean; archivedPages?: number } = {}) {
    let askedArchived = 0;
    const ch = {
      id: `${id}-c`,
      isTextBased: () => true,
      threads: {
        fetchArchived: async () => {
          const n = opts.archivedPages ?? 0;
          const page = n > askedArchived ? new Map([[`t${askedArchived + 1}`, thread(`t${askedArchived + 1}`)]]) : new Map();
          askedArchived++;
          return { threads: page, hasMore: askedArchived < n };
        },
      },
      messages: { fetch: async () => { reads.n++; return new Map([["a1", msg("a1", IN_ERA)]]); } },
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

  it("sweeps each server once, records them, and never reads them again", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    const g1 = guild("g1", reads);
    const g2 = guild("g2", reads);
    expect(await sweepOldThumbs(client([g1, g2]), (m) => said.push(m))).toMatchObject({ channels: 2, removed: 2, bad: new Set() });
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: ["g1", "g2"] });
    expect(reads.n).toBe(2);
    // A restart: both are recorded, so nothing is asked of Discord at all.
    expect(await sweepOldThumbs(client([g1, g2]), (m) => said.push(m))).toBeNull();
    expect(reads.n).toBe(2);
  });

  it("sweeps a server added back later, and adds it to the row", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ channels: 1 });
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: ["g1"] });
    // Added back: only that server is read, and it joins the row so the next restart leaves it alone.
    const g2 = guild("g2", reads);
    reads.n = 0;
    expect(await sweepOldThumbs(client([guild("g1", reads), g2]), (m) => said.push(m), "g2")).toMatchObject({ channels: 1, removed: 1 });
    expect(reads.n).toBe(1);
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: ["g1", "g2"] });
    expect(await sweepOldThumbs(client([g2]), (m) => said.push(m), "g2")).toBeNull();
  });

  it("follows the archived threads to the end of what it can list", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    // Two pages of archived threads, the second the last: the answer in each is cleaned, and the server is recorded.
    expect(await sweepOldThumbs(client([guild("g1", reads, { archivedPages: 2 })]), (m) => said.push(m))).toMatchObject({ removed: 3, bad: new Set() });
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: ["g1"] });
  });

  it("leaves a server it couldn't read out of the row, and looks again next start", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    const partial = await sweepOldThumbs(client([guild("g1", reads, { broken: true })]), (m) => said.push(m));
    expect(partial).toMatchObject({ channels: 0, removed: 0, bad: new Set(["g1"]) });
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: [] });
    expect(said.join("\n")).toContain("g1's channels");
    // The next start tries again, and this time it finishes and is recorded.
    expect(await sweepOldThumbs(client([guild("g1", reads)]), (m) => said.push(m))).toMatchObject({ removed: 1, bad: new Set() });
    expect(await kvGet<{ servers: string[] }>(SWEEP_KEY)).toMatchObject({ servers: ["g1"] });
  });

  it("doesn't sweep without the bot's own id: nothing could match, so nothing is recorded", async () => {
    const reads = { n: 0 };
    const said: string[] = [];
    expect(await sweepOldThumbs(client([guild("g1", reads)], true), (m) => said.push(m))).toBeNull();
    expect(reads.n).toBe(0);
    expect(await kvGet(SWEEP_KEY)).toBeNull();
    expect(said.join("\n")).toContain("own id isn't known");
  });
});
