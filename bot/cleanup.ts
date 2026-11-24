// The 👎 the bot used to put on every answer (7.9.2 until 8.0.1) is still on the answers it posted in between: a button
// that does nothing now. This takes it off, once — the first connection after this ships walks back through the recent
// messages of every channel the bot can read (and its active and recently archived threads), removes its own reaction from
// its own answers, and records each server it finished in a `kv` row, so a restart or a deploy doesn't scan again.
//
// Only its own reaction, only on its own message: a member's 👎 is theirs, and a 👍 stays. The counts are untouched — the
// `down` column is what people clicked, and it stays readable (bot/reactions.ts); nothing here writes a row.
//
// A server is recorded only when its whole walk finished: one it couldn't read, or one where a reaction wouldn't come off,
// is left out of the row, and the next start (or its own join, for a server added back) sweeps it. Recording is per
// server, so one server that keeps refusing never hides the others that are done.
import type { Client } from "discord.js";
import { kvGet, kvSet } from "../server/db.js";

/** The reaction being taken off, and the only thing this module looks for. */
export const OLD_DOWN = "👎";
/** No answer can carry one from before this: the thumbs shipped on 2026-11-22, so a page whose oldest message is older
 *  ends the walk (days of slack, since a deploy can lag its commit). */
export const THUMBS_FROM = Date.parse("2026-11-21T00:00:00Z");
/** Messages a request asks for (Discord's cap). */
export const PAGE = 100;
/** Archived threads read per request (Discord's cap). */
export const ARCHIVED = 100;
/** The `kv` row that says which servers the sweep has finished. */
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

/** A channel as the sweep reads it, and the server it belongs to (the unit a finished sweep is recorded in). */
export interface SweptChannel {
  id: string;
  guild: string;
  messages: { fetch: (opts: { limit: number; before?: string }) => Promise<SweptPage> };
}

export interface Sweep {
  /** The bot's own id: the only reactions it takes off are its own, on its own messages. */
  me: string;
  /** Every channel to look in, with the servers whose channels or threads couldn't be listed. */
  channels: () => Promise<{ channels: SweptChannel[]; bad: Set<string> }>;
}

export interface Swept {
  /** Channels walked. */
  channels: number;
  /** Messages read. */
  messages: number;
  /** Stale 👎s taken off. */
  removed: number;
  /** Servers where something couldn't be read or cleared: not finished, so not recorded, and tried again next start. */
  bad: Set<string>;
}

/** Take the bot's stale 👎s off its answers, channel by channel. Only thumbs-era messages are read: the walk stops at
 *  `THUMBS_FROM`, so a channel's older history is never requested. */
export async function sweepStaleThumbs(sweep: Sweep, log: (m: string) => void = () => {}): Promise<Swept> {
  const listed = await sweep.channels();
  const out: Swept = { channels: 0, messages: 0, removed: 0, bad: new Set(listed.bad) };
  for (const channel of listed.channels) {
    out.channels++;
    let before: string | undefined;
    for (;;) {
      let read: SweptMessage[];
      try {
        read = [...(await channel.messages.fetch({ limit: PAGE, ...(before ? { before } : {}) })).values()];
      } catch (e) {
        // No Read Message History there, or the channel or thread is gone: the server is left unfinished, and the next
        // channel goes on. A server that added the bot before 8.0.2 has no Read Message History, so say what fixes it.
        out.bad.add(channel.guild);
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
          // Left unfinished rather than counted and skipped: the next sweep reads this server again, so the 👎 isn't
          // stranded by a moment's network trouble.
          out.bad.add(channel.guild);
          log(`stale 👎: couldn't take one off ${channel.id}/${m.id} (${(e as Error)?.message ?? String(e)})`);
        }
      }
      // Past the oldest message on the page is older still, and no answer there had a 👎: that is the end of it.
      const oldest = read[read.length - 1];
      if (read.length < PAGE || oldest.createdTimestamp < THUMBS_FROM) break;
      before = oldest.id;
    }
  }
  return out;
}

/** A channel as the walk reads it. discord.js's `fetch` also takes a single message, so the paging call is spelled out
 *  here rather than in the walk. */
const pager = (ch: { id: string; messages: { fetch: unknown } }, guild: string): SweptChannel => ({
  id: ch.id,
  guild,
  messages: {
    fetch: (opts) => (ch.messages.fetch as unknown as (o: { limit: number; before?: string }) => Promise<SweptPage>)(opts),
  },
});

/** A page of a parent's archived threads. */
interface ThreadPage {
  threads: { values: () => Iterable<{ id: string; archiveTimestamp: number; isTextBased: () => boolean }> };
  hasMore: boolean;
}

/** Every channel to look in, in the named servers (a re-joined one), else in all of them: every text channel, and each
 *  server's active and recently archived threads (an answer posted in a thread has its own message id). A list that
 *  can't be read is logged, and its server is left unfinished. */
async function places(client: Client, log: (m: string) => void, servers?: string[]): Promise<{ channels: SweptChannel[]; bad: Set<string> }> {
  const out: SweptChannel[] = [];
  const seen = new Set<string>();
  const bad = new Set<string>();
  const add = (guild: string, ch: { id: string; messages: { fetch: unknown } }) => {
    if (seen.has(ch.id)) return;
    seen.add(ch.id);
    out.push(pager(ch, guild));
  };
  const missed = (guild: string, what: string, e: unknown) => {
    bad.add(guild);
    log(`stale 👎: couldn't list ${what} (${(e as Error)?.message ?? String(e)})`);
    return null;
  };
  for (const guild of client.guilds.cache.values()) {
    if (servers && !servers.includes(guild.id)) continue;
    const channels = await guild.channels.fetch().catch((e) => missed(guild.id, `${guild.id}'s channels`, e));
    for (const ch of channels?.values() ?? []) {
      if (!ch) continue;
      if (ch.isTextBased()) add(guild.id, ch);
      // A thread archives a day after its last message, so an answer from the thumbs era can be in one that has. Forum
      // and media parents hold threads too and aren't text channels themselves, so this is asked of every channel that
      // has threads. Public threads only: listing a private archived thread needs Manage Threads, which nothing else
      // here asks for, so an answer in one of those is the one place this sweep can't reach (bot/README.md says so).
      if (!("threads" in ch) || !ch.threads) continue;
      const fetchArchived = ch.threads.fetchArchived as unknown as (o: { limit: number; type: "public"; before?: Date }) => Promise<ThreadPage>;
      let before: Date | undefined;
      let last = 0;
      for (;;) {
        const archived = await fetchArchived.call(ch.threads, { limit: ARCHIVED, type: "public", ...(before ? { before } : {}) }).catch((e) => missed(guild.id, `${ch.id}'s archived threads`, e));
        if (!archived) break;
        for (const t of archived.threads.values()) if (t?.isTextBased()) add(guild.id, t);
        // Most recently archived first, so the last one is the oldest this page reached: ask for what is past it.
        const oldest = [...archived.threads.values()].pop();
        if (!archived.hasMore) break;
        // A page that didn't move is a page Discord won't page past: the server is left unfinished rather than recorded.
        if (!oldest || oldest.archiveTimestamp <= last) {
          bad.add(guild.id);
          log(`stale 👎: ${ch.id} has archived threads this walk can't page past; ${guild.id} is left for the next start`);
          break;
        }
        last = oldest.archiveTimestamp;
        before = new Date(last);
      }
    }
    const active = await guild.channels.fetchActiveThreads().catch((e) => missed(guild.id, `${guild.id}'s active threads`, e));
    for (const t of active?.threads.values() ?? []) if (t?.isTextBased()) add(guild.id, t);
  }
  return { channels: out, bad };
}

/** What the `kv` row keeps: the servers the sweep has finished, and when. */
interface SweepState {
  servers?: string[];
  at?: string;
}

/** Take the stale 👎s off, once per server: the `kv` row lists the servers it has finished, so a restart or a deploy
 *  doesn't scan them again, and a server it couldn't finish (or one added back later) is swept next time. Returns null
 *  when there was nothing left to sweep.
 *
 *  `only` is a server that was just added back (`GuildCreate`): its answers are still in Discord, so it is swept then,
 *  however the row stands for the others. */
export async function sweepOldThumbs(client: Client, log: (m: string) => void, only?: string): Promise<Swept | null> {
  const state = await kvGet<SweepState>(SWEEP_KEY).catch(() => null);
  const swept = new Set(state?.servers ?? []);
  // A server added back is swept then, unless the row already has it (it was swept before the bot was removed).
  const wanted = only ? (swept.has(only) ? [] : [only]) : [...client.guilds.cache.keys()].filter((id) => !swept.has(id));
  if (!wanted.length || (only && !client.guilds.cache.has(only))) return null;
  const me = client.user?.id;
  if (!me) {
    // Sweeping as "" would match no answer and record a run that did nothing: left for the next start instead.
    log("stale 👎: the bot's own id isn't known yet; the old thumbs-down is left for the next start");
    return null;
  }
  log(`stale 👎: taking the old thumbs-down off its answers${only ? ` in server ${only}` : ""}`);
  const result = await sweepStaleThumbs({ me, channels: () => places(client, log, only ? [only] : undefined) }, log);
  // Which servers this run finished: everything it walked, less what it couldn't read or clear.
  for (const id of wanted) if (!result.bad.has(id)) swept.add(id);
  // Read again before writing: a server joined while this run was walking must keep the row it wrote, not lose it to
  // this one. Union, never replace.
  const now = await kvGet<SweepState>(SWEEP_KEY).catch(() => null);
  for (const id of now?.servers ?? []) swept.add(id);
  await kvSet(SWEEP_KEY, { servers: [...swept], at: new Date().toISOString() }).catch((e) => {
    // Said, not thrown: the reactions are off already, and saying it ran again next time is worse than a second pass.
    log(`stale 👎: couldn't record the sweep (${(e as Error)?.message ?? String(e)}); it will run again next start`);
  });
  const left = result.bad.size;
  log(`stale 👎: took ${result.removed} off ${result.messages} messages in ${result.channels} channels${left ? `; ${left} server${left === 1 ? "" : "s"} couldn't be finished, and the next start tries again` : ""}`);
  return result;
}
