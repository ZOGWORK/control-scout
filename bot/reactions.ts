// The row behind each answer the bot posted (migration 104), and the one thing a reaction on it does: a 👎 added by a
// person, on purpose, is a report — filed as a GitHub issue with the question the answer was written for
// (bot/report.ts, bot/handler.ts `downvoted`).
//
// There is no 👍. The bot used to add one to every answer and count it, and a 👍/👎 pair read as like/dislike rather
// than "report this": the bot puts no emoji on an answer any more, and nothing is counted. What the thumbs collected
// before that stays readable (`up` and `down`, reactionUsage, the owner console); nothing writes them, and the emoji the
// bot itself added are taken off once, on the first start after this (bot/cleanup.ts).
//
// Only messages the bot posted have a row (trackAnswer), so a reaction on anything else is ignored: a 👎 can't report a
// message the bot never wrote.
import { get, run } from "../server/db.js";
import { askText } from "./asks.js";

/** The reaction a person adds to an answer to report it. The bot never adds one itself: only a deliberate click does
 *  this, which is what makes it a report rather than a button everybody is prompted to press. */
export const REPORT = "👎";

/** Keep an answer's row, with the question it answered (redacted and one line, as every ask is: `askText`), which is
 *  what a 👎 report names. A message that is already known keeps its row. */
export async function trackAnswer(messageId: string, guild: string | null, question = "", now = Date.now()): Promise<void> {
  if (!messageId) return;
  await run(
    "INSERT OR IGNORE INTO discord_answers (message_id, guild_id, up, down, question, voted_at) VALUES (?, ?, 0, 0, ?, ?)",
    [messageId, guild, askText(question) || null, new Date(now).toISOString()],
  );
}

/** One of the bot's answers, as a 👎 finds it: the question it was written for (null when the row predates answers
 *  keeping it, migration 105), and the issue a 👎 on it already opened, if one did (migration 109). */
export interface AnswerRow {
  question: string | null;
  report: { number: number; url: string } | null;
}

/** The row for a message, or null when the bot never posted it: that null is what keeps a 👎 on somebody else's message
 *  from filing anything. */
export async function answerRow(messageId: string): Promise<AnswerRow | null> {
  if (!messageId) return null;
  const r = await get<{ question: string | null; report_number: number | null; report_url: string | null }>(
    "SELECT question, report_number, report_url FROM discord_answers WHERE message_id = ?", [messageId]);
  if (!r) return null;
  const number = r.report_number == null ? null : Number(r.report_number);
  return { question: r.question ?? null, report: number != null && r.report_url ? { number, url: r.report_url } : null };
}

/** Keep the issue a 👎 on this answer opened: a second 👎 an hour later, or after a restart, finds it on the row and
 *  answers with the same issue instead of filing a duplicate. */
export async function markReported(messageId: string, issue: { number: number; url: string }): Promise<void> {
  if (!messageId) return;
  await run("UPDATE discord_answers SET report_number = ?, report_url = ? WHERE message_id = ?", [issue.number, issue.url, messageId]);
}

/** An answer as a reaction carries it, whole enough to report. With `Partials.Message` Discord sends only an id for a
 *  message it has no copy of (an answer from before the bot's last restart), so it is fetched — without that the issue
 *  has none of the answer's words and the report has no nickname. A fetch that fails leaves what arrived: a thinner
 *  report beats none. */
export interface ReactedAnswer {
  partial?: boolean;
  fetch?: () => Promise<ReactedAnswer>;
}
export async function wholeAnswer<T extends ReactedAnswer>(message: T): Promise<T> {
  if (!message.partial || !message.fetch) return message;
  // `fetch` gives back the same kind of message it was called on, which is what Discord sends.
  return (await message.fetch().catch(() => message)) as T;
}

/** The name Discord shows the reporter by in that server — the nickname, not the handle — for the issue's "reported by". A
 *  `MessageReaction` carries no member of its own (only the gateway's raw payload does), so it comes from the answer's
 *  guild's member cache. A reactor who isn't cached is unnamed here, and the report falls back to their global name or
 *  handle (bot/handler.ts `shownName`) instead of losing the report. */
export function reporterName(
  message: { guild?: { members: { cache: { get(id: string): { displayName?: string | null } | undefined } } } | null } | null,
  userId: string,
): string | null {
  const name = message?.guild?.members.cache.get(userId)?.displayName;
  return name && name.trim() ? name.trim() : null;
}

/** Every vote the bot's answers collected while the thumbs existed, for the owner console. `down` is what a 👎 counted
 *  before it was removed; nothing adds to either now — a 👎 files a report instead of counting. */
export async function reactionUsage(): Promise<{ up: number; down: number }> {
  const r = await get<{ up: number; down: number }>("SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM discord_answers");
  return { up: Number(r?.up ?? 0), down: Number(r?.down ?? 0) };
}
