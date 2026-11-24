// The 👎 the bot used to put on every answer (7.9.2 until 8.0.1) is still on the answers it posted in between: a button
// that does nothing now. This takes it off, once — the first connection after this ships walks back through the recent
// messages of every channel the bot can read (and its active and recently archived threads), removes its own reaction from
// its own answers, and records that it has in a `kv` row, so a restart or a deploy doesn't scan again.
//
// Only its own reaction, only on its own message: a member's 👎 is theirs, and a 👍 stays. The counts are untouched — the
// `down` column is what people clicked, and it stays readable (bot/reactions.ts); nothing here writes a row.
//
// The sweep is recorded only when it finished: a channel it couldn't read, or one with more history than it walks back
// through, leaves the row unset, and the next start looks again.
import type { Client } from "discord.js";
import { kvGet, kvSet } from "../server/db.js";

/** The reaction being taken off, and the only thing this module looks for. */
export const OLD_DOWN = "👎";
/** No answer can carry one from before this: the thumbs shipped on 2026-11-22, so a page whose oldest message is older
 *  ends the walk (days of slack, since a deploy can lag its commit). */
export const THUMBS_FROM = Date.parse("2026-11-21T00:00:00Z");
/** Messages a request asks for (Discord's cap). */
export const PAGE = 100;
/** Pages one channel is walked back at most: a backstop under the date, for a channel with a run of history newer than
 *  it. A channel that reaches it short of the date is left for the next start rather than called swept. */
export const PAGES = 20;
/** Archived threads read per channel and kind: the newest ones, which is where two days of answers would be. */
export const ARCHIVED = 100;
/** The `kv` row that says the sweep has run. */
export const SWEEP_KEY = "bot:down-sweep";

/** One reaction as the sweep reads it: the emoji, whether this bot is the one who added it, and how to take it off. */
export interface SweptReaction {
  emoji: { name: string | null };
  /** Discord's word for "this account added it" — not "a person added it". */
  me: boolean;
  users: { remove: (user: string) => Promise<unknown> };
}

/** A message as the sweep reads it. */
export interface SweptMessage {
  id: string;
  createdTimestamp: number;
  author: { id: string } | null;
  reactions: { cache: { values: () => Iterable<SweptReaction> } };
}

/** One page of a channel's history, newest first. Discord's pages are a `Collection` — a `Map`, so its values are the
 *  messages and the keys are their ids, and spreading the page itself would yield pairs. */
export interface SweptPage {
  values: () => Iterable<SweptMessage>;
}

/** A channel as the sweep reads it. */
export interface SweptChannel {
  id: string;
  messages: { fetch: (opts: { limit: number; before?: string }) => Promise<SweptPage> };
}

export interface Sweep {
  /** The bot's own id: the only reactions it takes off are its own, on its own messages. */
  me: string;
  /** Every channel to look in, with how many lists of them couldn't be read, and how many were too long to list fully. */
  channels: () => Promise<{ channels: SweptChannel[]; failed: number; capped: number }>;
}

export interface Swept {
  /** Channels walked. */
  channels: number;
  /** Messages read. */
  messages: number;
  /** Stale 👎s taken off. */
  removed: number;
  /** Channels or reactions that couldn't be read or cleared: logged, never fatal. */
  failed: number;
  /** Channels with more history than the walk goes back through, so their older answers weren't reached. */
  capped: number;
}

/** Take the bot's stale 👎s off its answers, channel by channel. Only thumbs-era messages are read: the walk stops at
 *  `THUMBS_FROM`, so a channel's older history is never requested. */
export async function sweepStaleThumbs(sweep: Sweep, log: (m: string) => void = () => {}): Promise<Swept> {
  const listed = await sweep.channels();
  const out: Swept = { channels: 0, messages: 0, removed: 0, failed: listed.failed, capped: listed.capped };
  for (const channel of listed.channels) {
    out.channels++;
    let before: string | undefined;
    let ended = false;
    for (let page = 0; page < PAGES && !ended; page++) {
      let read: SweptMessage[];
      try {
        read = [...(await channel.messages.fetch({ limit: PAGE, ...(before ? { before } : {}) })).values()];
      } catch (e) {
        // No Read Message History there, or the channel or thread is gone: counted, and the next channel goes on.
        out.failed++;
        ended = true;
        // A server that added the bot before 8.0.2 has no Read Message History: said plainly, since only a new invite
        // (or the role's permissions) fixes it, and every start asks again until it does.
        const code = (e as { code?: number })?.code;
        const why = code === 50001 || code === 50013 ? " — Control Scout needs Read Message History there" : "";
        log(`stale 👎: couldn't read ${channel.id}${why} (${(e as Error)?.message ?? String(e)})`);
        break;
      }
      if (!read.length) {
        ended = true;
        break;
      }
      out.messages += read.length;
      for (const m of read) {
        if (m.author?.id !== sweep.me) continue;
        // `me` is Discord saying this bot added it: a member's own 👎 on the same answer stays.
        const stale = [...m.reactions.cache.values()].find((r) => r.emoji.name === OLD_DOWN && r.me);
        if (!stale) continue;
        try {
          await stale.users.remove(sweep.me);
          out.removed++;
        } catch (e) {
          out.failed++;
          log(`stale 👎: couldn't take one off ${channel.id}/${m.id} (${(e as Error)?.message ?? String(e)})`);
        }
      }
      // Past the oldest message on the page is older still, and no answer there had a 👎: that is the end of it.
      const oldest = read[read.length - 1];
      if (read.length < PAGE || oldest.createdTimestamp < THUMBS_FROM) ended = true;
      else before = oldest.id;
    }
    if (!ended) {
      out.capped++;
      log(`stale 👎: ${channel.id} has more history than this walk goes back through; its older answers are left for the next start`);
    }
  }
  return out;
}

/** A channel as the walk reads it. discord.js's `fetch` also takes a single message, so the paging call is spelled out
 *  here rather than in the walk. */
const pager = (ch: { id: string; messages: { fetch: unknown } }): SweptChannel => ({
  id: ch.id,
  messages: {
    fetch: (opts) => (ch.messages.fetch as unknown as (o: { limit: number; before?: string }) => Promise<SweptPage>)(opts),
  },
});

/** Every channel to look in: every text channel of every server the bot is in, and each server's active and recently
 *  archived threads (an answer posted in a thread has its own message id). A list that can't be read is logged and
 *  counted, and the sweep is then not recorded as done. */
async function places(client: Client, log: (m: string) => void): Promise<{ channels: SweptChannel[]; failed: number; capped: number }> {
  const out: SweptChannel[] = [];
  const seen = new Set<string>();
  const add = (ch: { id: string; messages: { fetch: unknown } }) => {
    if (seen.has(ch.id)) return;
    seen.add(ch.id);
    out.push(pager(ch));
  };
  let failed = 0;
  let capped = 0;
  const missed = (what: string, e: unknown) => {
    failed++;
    log(`stale 👎: couldn't list ${what} (${(e as Error)?.message ?? String(e)})`);
    return null;
  };
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch((e) => missed(`${guild.id}'s channels`, e));
    for (const ch of channels?.values() ?? []) {
      if (!ch) continue;
      if (ch.isTextBased()) add(ch);
      // A thread archives a day after its last message, so an answer from the thumbs era can be in one that has: the
      // most recently archived, which is where two days of answers would be. Forum and media parents hold threads too
      // and aren't text channels themselves, so this is asked of every channel that has threads. Public threads only:
      // listing a private archived thread needs Manage Threads, which nothing else here asks for.
      if (!("threads" in ch) || !ch.threads) continue;
      const archived = await ch.threads.fetchArchived({ limit: ARCHIVED, type: "public" }).catch((e) => missed(`${ch.id}'s archived threads`, e));
      if (archived?.hasMore) {
        capped++;
        log(`stale 👎: ${ch.id} has archived more threads than this walk reads; their older answers are left for the next start`);
      }
      for (const t of archived?.threads.values() ?? []) if (t?.isTextBased()) add(t);
    }
    const active = await guild.channels.fetchActiveThreads().catch((e) => missed(`${guild.id}'s active threads`, e));
    for (const t of active?.threads.values() ?? []) if (t?.isTextBased()) add(t);
  }
  return { channels: out, failed, capped };
}

/** Take the stale 👎s off, once ever: the `kv` row says it has run, so a restart or a deploy doesn't scan again. Returns
 *  null when it had already run. A sweep that missed something — a channel it couldn't read, one with more history than
 *  it walks back through — isn't recorded, so the next start looks again. */
export async function sweepOldThumbs(client: Client, log: (m: string) => void): Promise<Swept | null> {
  const state = await kvGet<{ done?: boolean; removed?: number }>(SWEEP_KEY).catch(() => null);
  if (state?.done) return null;
  const me = client.user?.id;
  if (!me) {
    // Sweeping as "" would match no answer and record a run that did nothing: left for the next start instead.
    log("stale 👎: the bot's own id isn't known yet; the old thumbs-down is left for the next start");
    return null;
  }
  log("stale 👎: taking the old thumbs-down off its answers");
  const swept = await sweepStaleThumbs({ me, channels: () => places(client, log) }, log);
  if (swept.failed || swept.capped) {
    log(`stale 👎: took ${swept.removed} off ${swept.messages} messages in ${swept.channels} channels, but ${swept.failed + swept.capped} couldn't be finished; the next start looks again`);
    return swept;
  }
  await kvSet(SWEEP_KEY, { done: true, at: new Date().toISOString(), ...swept }).catch((e) => {
    // Said, not thrown: the reactions are off already, and saying it ran again next time is worse than a second pass.
    log(`stale 👎: couldn't record the sweep (${(e as Error)?.message ?? String(e)}); it will run again next start`);
  });
  log(`stale 👎: took ${swept.removed} off ${swept.messages} messages in ${swept.channels} channels`);
  return swept;
}
