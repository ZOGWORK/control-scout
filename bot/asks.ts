// What the bot was asked, kept so the owner can see it (migration 104): every question, the step search answered it at,
// whether Bruno's chat answered it, and how long that took. Two things read it: the console's "questions the bot couldn't
// answer" (the phrasings people actually use, which the site's own search never sees) and its chats-a-day, Bruno-share
// and latency numbers.
//
// A question is stored as typed with personal data redacted (server/searchFailures.ts `redact`), and no user id is kept:
// a row is the server, the words and the outcome. The table is private (server/data/snapshot.ts), pruned after
// KEEP_DAYS, and deleted with its server's other data (bot/forget.ts).
import { all, get, run } from "../server/db.js";
import { redact } from "../server/searchFailures.js";

/** How long an ask is kept: long enough to see a phrasing come up twice, short enough to stay small. */
export const KEEP_DAYS = 90;
/** The most characters of a question kept. */
export const QUESTION_MAX = 500;
/** Every PRUNE_EVERY writes, asks past KEEP_DAYS are deleted (the table is read by month at most). */
export const PRUNE_EVERY = 200;
let writes = 0;

/** One ask, as the handler knows it: the words, the step, who answered, and how long it took. */
export interface AskRecord {
  question: string;
  step: string | null;
  /** Bruno's chat replied (not the bot's own fallback). */
  chat: boolean;
  /** It was answered at all: a card, a stat, or Bruno's reply. A sorry card is not. */
  answered: boolean;
  ms: number | null;
  guild: string | null;
}

/** Redact a question for storage: nothing personal, a bounded length, one line. */
export const askText = (q: string) => redact(String(q ?? "")).replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX);

/** Record one ask. No caller waits for it (an answer is not worth a failed write), so a failure only ends this write. */
export async function noteAsk(r: AskRecord, now = Date.now()): Promise<void> {
  const question = askText(r.question);
  if (!question) return;
  await run(
    "INSERT INTO discord_asks (guild_id, question, step, chat, answered, ms, asked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [r.guild, question, r.step, r.chat ? 1 : 0, r.answered ? 1 : 0, r.ms == null ? null : Math.max(0, Math.round(r.ms)), new Date(now).toISOString()],
  );
  if (++writes % PRUNE_EVERY === 0) await prune(now);
}

/** Forget asks older than KEEP_DAYS. */
export async function prune(now = Date.now()): Promise<number> {
  return run("DELETE FROM discord_asks WHERE asked_at < ?", [new Date(now - KEEP_DAYS * 86_400_000).toISOString()]);
}

/** One question the bot couldn't answer, as the console lists it. */
export interface Unanswered {
  /** The latest spelling of it, as asked (redacted). */
  question: string;
  /** How many times it was asked, any server. */
  count: number;
  /** The step search answered it at (recovery, no-match…), or null when no answer was recorded. */
  step: string | null;
  /** The last time it was asked. */
  lastAt: string;
  /** How many servers asked it. */
  servers: number;
}

/**
 * The questions the bot couldn't answer, most asked first: grouped by the lowercased words, so a retry or a different
 * capitalisation is one entry. SQLite takes the bare columns from the MAX() row, so the spelling, step and time shown are
 * the latest ask's.
 */
export async function topUnanswered(limit = 10, now = Date.now()): Promise<Unanswered[]> {
  if (limit <= 0) return [];
  const rows = await all<{ question: string; count: number; step: string | null; last_at: string; servers: number }>(
    `SELECT question, COUNT(*) AS count, step, MAX(asked_at) AS last_at, COUNT(DISTINCT guild_id) AS servers
       FROM discord_asks WHERE answered = 0 AND asked_at >= ?
      GROUP BY lower(trim(question)) ORDER BY count DESC, last_at DESC LIMIT ?`,
    [new Date(now - KEEP_DAYS * 86_400_000).toISOString(), Math.min(50, limit)],
  );
  return rows.map((r) => ({ question: String(r.question), count: Number(r.count), step: r.step ?? null, lastAt: String(r.last_at), servers: Number(r.servers) }));
}

/** The bot's own numbers at a glance: how much it is asked, how often Bruno answered, and how long it took. */
export interface AskUsage {
  asksToday: number;
  asksWeek: number;
  /** Of the week's asks, the share answered at all, and the share Bruno's chat answered (0–100, null with no asks). */
  answeredPct: number | null;
  chatPct: number | null;
  /** The middle answer time over the week, in milliseconds (null: none recorded). */
  medianMs: number | null;
}

/** Midnight UTC today, as the stored timestamps are written. */
const dayStart = (now: number) => `${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`;

export async function askUsage(now = Date.now()): Promise<AskUsage> {
  const week = new Date(now - 7 * 86_400_000).toISOString();
  const totals = await get<{ week: number; answered: number; chat: number; today: number }>(
    `SELECT COUNT(*) AS week, COALESCE(SUM(answered), 0) AS answered, COALESCE(SUM(chat), 0) AS chat,
            COALESCE(SUM(asked_at >= ?), 0) AS today
       FROM discord_asks WHERE asked_at >= ?`,
    [dayStart(now), week],
  );
  // The middle of every timed ask this week, found by position rather than by reading them all into a capped sample: a
  // LIMIT would make a busy week's median the middle of its fastest 5,000, low exactly when it matters most.
  const timed = await get<{ n: number }>("SELECT COUNT(*) AS n FROM discord_asks WHERE ms IS NOT NULL AND asked_at >= ?", [week]);
  const nTimed = Number(timed?.n ?? 0);
  const middle = nTimed
    ? await get<{ ms: number }>("SELECT ms FROM discord_asks WHERE ms IS NOT NULL AND asked_at >= ? ORDER BY ms LIMIT 1 OFFSET ?", [week, Math.floor(nTimed / 2)])
    : null;
  const median = middle ? Number(middle.ms) : null;
  const n = Number(totals?.week ?? 0);
  const pct = (x: number) => (n ? Math.round((Number(x) / n) * 100) : null);
  return {
    asksToday: Number(totals?.today ?? 0),
    asksWeek: n,
    answeredPct: pct(totals?.answered ?? 0),
    chatPct: pct(totals?.chat ?? 0),
    medianMs: median,
  };
}
