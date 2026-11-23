// The quality signal on an answer: 👍 and 👎 reactions, counted (migration 104). The bot adds both to every answer it
// posts; a click is a count on that answer, never a record of who clicked (no user id is kept), so the owner console can
// see whether answers land at all.
//
// Only messages the bot posted have a row (trackAnswer), so a reaction on anything else is ignored: nobody can inflate a
// number by reacting in a channel the bot was never in.
//
// The row keeps the question the answer was given for (migration 105), so a 👎 can name it: a downvote says the answer
// was wrong rather than missing, which search can't see for itself (it called the answer answered). The bot's process
// feeds that question to the site's failed-search queue (bot/index.ts, server/searchFailures.ts `noteBotDownvote`).
import { get, run } from "../server/db.js";
import { askText } from "./asks.js";

export const GOOD = "👍";
export const BAD = "👎";

/** Keep an answer's row so its reactions count, with the question it answered so a 👎 can name it (redacted and one
 *  line, as every ask is: `askText`). A message that is already known keeps its counts. */
export async function trackAnswer(messageId: string, guild: string | null, question = "", now = Date.now()): Promise<void> {
  if (!messageId) return;
  await run(
    "INSERT OR IGNORE INTO discord_answers (message_id, guild_id, up, down, question, voted_at) VALUES (?, ?, 0, 0, ?, ?)",
    [messageId, guild, askText(question) || null, new Date(now).toISOString()],
  );
}

/** A 👎 added to an answer: counted, and whether it is the answer's first one — with the question it answered and its
 *  server, so a first downvote can be filed. Null: a message the bot never posted, which has no row to count on. */
export async function downVote(messageId: string, now = Date.now()): Promise<{ question: string | null; guild: string | null; first: boolean } | null> {
  if (!messageId) return null;
  // Read before the count goes up: `first` is what the row was, because a second 👎 on one answer is the same
  // complaint about the same question, and the queue counts a repeat as a repeat rather than as a new entry.
  const before = await get<{ question: string | null; guild_id: string | null; down: number }>(
    "SELECT question, guild_id, down FROM discord_answers WHERE message_id = ?", [messageId],
  );
  if (!before) return null;
  await vote(messageId, BAD, 1, now);
  return { question: before.question ?? null, guild: before.guild_id ?? null, first: Number(before.down) === 0 };
}

/** One vote on an answer: `delta` 1 for a reaction added, -1 for one taken back. Never below zero. */
export async function vote(messageId: string, emoji: string, delta: 1 | -1 = 1, now = Date.now()): Promise<number> {
  const column = emoji === GOOD ? "up" : emoji === BAD ? "down" : null;
  if (!column || !messageId) return 0;
  return run(
    `UPDATE discord_answers SET ${column} = MAX(0, ${column} + ?), voted_at = ? WHERE message_id = ?`,
    [delta, new Date(now).toISOString(), messageId],
  );
}

/** Every vote the bot's answers have collected. */
export async function reactionUsage(): Promise<{ up: number; down: number }> {
  const r = await get<{ up: number; down: number }>("SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM discord_answers");
  return { up: Number(r?.up ?? 0), down: Number(r?.down ?? 0) };
}
