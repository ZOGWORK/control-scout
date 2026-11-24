// The 👎 the bot used to put on every answer (7.9.2 until 8.0.1) is still on the answers it posted in between: a button
// that does nothing now. This takes it off, once — the first connection after this ships walks back through the recent
// messages of every channel the bot can read (and its active threads), removes its own reaction from its own answers, and
// records that it has in a `kv` row, so a restart or a deploy doesn't scan again.
//
// Only its own reaction, only on its own message: a member's 👎 is theirs, and a 👍 stays. The counts are untouched — the
// `down` column is what people clicked, and it stays readable (bot/reactions.ts); nothing here writes a row.
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
 *  it and no footer to say otherwise. Two thousand messages a channel. */
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

/** A channel as the sweep reads it: pages of its history, newest first. */
export interface SweptChannel {
  id: string;
  messages: { fetch: (opts: { limit: number; before?: string }) => Promise<Iterable<SweptMessage>> };
}

export interface Sweep {
  /** The bot's own id: the only reactions it takes off are its own, on its own messages. */
  me: string;
  /** Every channel to look in, all servers together. */
  channels: () => Promise<SweptChannel[]>;
}

export interface Swept {
  /** Channels walked. */
  channels: number;
  /** Messages read. */
  messages: number;
  /** Stale 👎s taken off. */
  removed: number;
  /** Channels that couldn't be read, or reactions that couldn't be taken off: logged, never fatal. */
  failed: number;
}

/** Take the bot's stale 👎s off its answers, channel by channel. Only 👍-era messages are read: the walk stops at
 *  `THUMBS_FROM`, so a channel's older history is never requested. */
export async function sweepStaleThumbs(sweep: Sweep, log: (m: string) => void = () => {}): Promise<Swept> {
  const out: Swept = { channels: 0, messages: 0, removed: 0, failed: 0 };
  for (const channel of await sweep.channels()) {
    out.channels++;
    let before: string | undefined;
    for (let page = 0; page < PAGES; page++) {
      let read: SweptMessage[];
      try {
        read = [...await channel.messages.fetch({ limit: PAGE, ...(before ? { before } : {}) })];
      } catch (e) {
        // No Read Message History there, or the channel or thread is gone: counted, and the next channel goes on.
        out.failed++;
        log(`stale 👎: couldn't read ${channel.id} (${(e as Error)?.message ?? String(e)})`);
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
          out.failed++;
          log(`stale 👎: couldn't take one off ${channel.id}/${m.id} (${(e as Error)?.message ?? String(e)})`);
        }
      }
      // Oldest first is the end of it: everything past this message is older still, and no answer there had a 👎.
      const oldest = read[read.length - 1];
      if (read.length < PAGE || oldest.createdTimestamp < THUMBS_FROM) break;
      before = oldest.id;
    }
  }
  return out;
}

/** The channels to look in: every text channel of every server the bot is in, and each server's active and recently
 *  archived threads (an answer posted in a thread has its own message id). A channel the bot can't see isn't listed; the
 *  read would fail anyway. */
async function readable(client: Client): Promise<SweptChannel[]> {
  const out: SweptChannel[] = [];
  const seen = new Set<string>();
  const add = (ch: SweptChannel) => { if (!seen.has(ch.id)) { seen.add(ch.id); out.push(ch); } };
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => null);
    for (const ch of channels?.values() ?? []) {
      if (!ch?.isTextBased()) continue;
      add(ch);
      // A thread archives a day after its last message, so an answer from the thumbs era can be in one that has:
      // the most recently archived of each kind, which is where two days of answers would be.
      if (!("threads" in ch) || !ch.threads) continue;
      for (const type of ["public", "private"] as const) {
        const archived = await ch.threads.fetchArchived({ limit: ARCHIVED, type }).catch(() => null);
        for (const t of archived?.threads.values() ?? []) if (t?.isTextBased()) add(t);
      }
    }
    const active = await guild.channels.fetchActiveThreads().catch(() => null);
    for (const t of active?.threads.values() ?? []) if (t?.isTextBased()) add(t);
  }
  return out;
}

/** Take the stale 👎s off, once ever: the `kv` row says it has run, so a restart or a deploy doesn't scan again. Returns
 *  null when it had already run. A run that fails part-way isn't recorded, so the next start tries again. */
export async function sweepOldThumbs(client: Client, log: (m: string) => void): Promise<Swept | null> {
  const state = await kvGet<{ done?: boolean; removed?: number }>(SWEEP_KEY).catch(() => null);
  if (state?.done) return null;
  log("stale 👎: taking the old thumbs-down off its answers");
  const swept = await sweepStaleThumbs({ me: client.user?.id ?? "", channels: () => readable(client) }, log);
  await kvSet(SWEEP_KEY, { done: true, at: new Date().toISOString(), ...swept }).catch((e) => {
    // Said, not thrown: the reactions are off already, and saying it ran again next time is worse than a second pass.
    log(`stale 👎: couldn't record the sweep (${(e as Error)?.message ?? String(e)}); it will run again next start`);
  });
  log(`stale 👎: took ${swept.removed} off ${swept.messages} messages in ${swept.channels} channels${swept.failed ? ` (${swept.failed} couldn't be read or cleared)` : ""}`);
  return swept;
}
