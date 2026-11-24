// The 👎 the bot used to put on every answer (7.9.2 until 8.0.1) is still on the answers it posted in between: a button
// that does nothing now. This takes it off, once — the first connection after this ships walks back through every text
// channel it can read (and each server's active threads), removes its own reaction from its own answers, and records the
// sweep in a `kv` row, so a restart or a deploy doesn't scan again.
//
// Only its own reaction, only on its own message: a member's 👎 is theirs, and a 👍 stays. The counts are untouched — the
// `down` column is what people clicked, and it stays readable (bot/reactions.ts); nothing here writes a row.
//
// The row is written only when the whole walk finished. A server that added the bot before 8.0.2 has no Read Message
// History, so its channels can't be read: the sweep says which and what is missing, isn't recorded, and tries again on the
// next start (the walk is bounded by the days the thumbs existed, so a retry is a handful of pages a channel).
import type { Client } from "discord.js";
import { kvGet, kvSet } from "../server/db.js";

/** The reaction being taken off, and the only thing this module looks for. */
export const OLD_DOWN = "👎";
/** No answer can carry one from before this: the thumbs shipped on 2026-11-22, so a page whose oldest message is older
 *  ends the walk (days of slack, since a deploy can lag its commit). */
export const THUMBS_FROM = Date.parse("2026-11-21T00:00:00Z");
/** Messages a request asks for (Discord's cap). */
export const PAGE = 100;
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
  /** Every channel to look in, and how many lists of them couldn't be read. */
  channels: () => Promise<{ channels: SweptChannel[]; unreadable: number }>;
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
}

/** Discord's answers for a reaction that is already gone, or a message that is: nothing to do, not a failure. */
const GONE = new Set([10008, 10014]);

/** Take the bot's stale 👎s off its answers, channel by channel. Only thumbs-era messages are read: the walk stops at
 *  `THUMBS_FROM`, so a channel's older history is never requested. */
export async function sweepStaleThumbs(sweep: Sweep, log: (m: string) => void = () => {}): Promise<Swept> {
  const listed = await sweep.channels();
  const out: Swept = { channels: 0, messages: 0, removed: 0, failed: listed.unreadable };
  for (const channel of listed.channels) {
    out.channels++;
    let before: string | undefined;
    for (;;) {
      let read: SweptMessage[];
      try {
        read = [...(await channel.messages.fetch({ limit: PAGE, ...(before ? { before } : {}) })).values()];
      } catch (e) {
        // Counted, and the next channel goes on. A server that added the bot before 8.0.2 has no Read Message History,
        // so say what is missing: only a new invite (or the role's permissions) fixes it.
        out.failed++;
        const code = (e as { code?: number })?.code;
        const why = code === 50001 || code === 50013 ? " — Control Scout needs Read Message History there" : "";
        log(`stale 👎: couldn't read ${channel.id}${why} (${(e as Error)?.message ?? String(e)})`);
        break;
      }
      if (!read.length) break;
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
          // Already gone (a second pass over the same answer) is fine; anything else means this answer isn't known to be
          // clean, so the sweep isn't recorded and the next start asks again.
          if (GONE.has((e as { code?: number })?.code ?? 0)) continue;
          out.failed++;
          log(`stale 👎: couldn't take one off ${channel.id}/${m.id} (${(e as Error)?.message ?? String(e)})`);
        }
      }
      // Past the oldest message on the page is older still, and no answer there had a 👎: that is the end of it.
      const oldest = read[read.length - 1];
      if (read.length < PAGE || oldest.createdTimestamp < THUMBS_FROM) break;
      // A page that hands back the message we asked to go before would loop forever: said, and left unfinished.
      if (oldest.id === before) {
        out.failed++;
        log(`stale 👎: ${channel.id} isn't paging back past ${oldest.id}`);
        break;
      }
      before = oldest.id;
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

/** Every channel to look in: every text channel of every server the bot is in, and each server's active threads (an
 *  answer posted in a thread has its own message id). Archived threads are out of reach on purpose: listing the public
 *  ones needs Read Message History and the private ones need Manage Threads, and a thread from the two days the thumbs
 *  existed has to still be active to hold one now (bot/README.md says so). */
async function places(client: Client, log: (m: string) => void): Promise<{ channels: SweptChannel[]; unreadable: number }> {
  const out: SweptChannel[] = [];
  const seen = new Set<string>();
  const add = (ch: { id: string; messages: { fetch: unknown } }) => {
    if (seen.has(ch.id)) return;
    seen.add(ch.id);
    out.push(pager(ch));
  };
  let unreadable = 0;
  const missed = (what: string, e: unknown) => {
    unreadable++;
    log(`stale 👎: couldn't list ${what} (${(e as Error)?.message ?? String(e)})`);
    return null;
  };
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch((e) => missed(`${guild.id}'s channels`, e));
    for (const ch of channels?.values() ?? []) if (ch?.isTextBased()) add(ch);
    const active = await guild.channels.fetchActiveThreads().catch((e) => missed(`${guild.id}'s active threads`, e));
    for (const t of active?.threads.values() ?? []) if (t?.isTextBased()) add(t);
  }
  return { channels: out, unreadable };
}

/** Take the stale 👎s off, once: the `kv` row says it has run, so a restart or a deploy doesn't scan again. Returns null
 *  when it had already run.
 *
 *  `force` is a server added back later (bot/index.ts): its answers are still in Discord, so the pass runs again, and
 *  taking off a 👎 that is already gone is not a failure. */
export async function sweepOldThumbs(client: Client, log: (m: string) => void, opts: { force?: boolean } = {}): Promise<Swept | null> {
  const state = await kvGet<{ done?: boolean }>(SWEEP_KEY).catch(() => null);
  if (state?.done && !opts.force) return null;
  const me = client.user?.id;
  if (!me) {
    // Sweeping as "" would match no answer and record a run that did nothing: left for the next start instead.
    log("stale 👎: the bot's own id isn't known yet; the old thumbs-down is left for the next start");
    return null;
  }
  log("stale 👎: taking the old thumbs-down off its answers");
  const swept = await sweepStaleThumbs({ me, channels: () => places(client, log) }, log);
  const done = swept.failed === 0;
  if (done) {
    await kvSet(SWEEP_KEY, { done: true, at: new Date().toISOString(), removed: swept.removed }).catch((e) => {
      // Said, not thrown: the reactions are off already, and saying it ran again next time is worse than a second pass.
      log(`stale 👎: couldn't record the sweep (${(e as Error)?.message ?? String(e)}); it will run again next start`);
    });
  }
  log(`stale 👎: took ${swept.removed} off ${swept.messages} messages in ${swept.channels} channels${done ? "" : `; ${swept.failed} couldn't be read or cleared, so the next start tries again`}`);
  return swept;
}
