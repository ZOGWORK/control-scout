// The quality signal on an answer: a 👍 reaction, counted (migration 104). The bot adds it to every answer it posts; a
// click is a count on that answer, never a record of who clicked (no user id is kept), so the owner console can see
// whether answers land at all.
//
// Only messages the bot posted have a row (trackAnswer), so a reaction on anything else is ignored: nobody can inflate a
// number by reacting in a channel the bot was never in.
//
// There is no 👎. It was meant as "this answer is wrong, file it", and it filed the question the answer was written for
// in the site's failed-search queue — but people read it as a dislike button, so answers that were fine put questions in
// the queue and drew a note explaining what the button did. What it counted before stays: the `down` column and the
// queue's `downvoted` rows are still read (reactionUsage, the queue's own re-check); nothing writes them any more.
import { get, run } from "../server/db.js";
import { askText } from "./asks.js";

export const GOOD = "👍";

/** Keep an answer's row so its reactions count, with the question it answered (redacted and one line, as every ask is:
 *  `askText`), which is the record of what the answer was for. A message that is already known keeps its counts. */
export async function trackAnswer(messageId: string, guild: string | null, question = "", now = Date.now()): Promise<void> {
  if (!messageId) return;
  await run(
    "INSERT OR IGNORE INTO discord_answers (message_id, guild_id, up, down, question, voted_at) VALUES (?, ?, 0, 0, ?, ?)",
    [messageId, guild, askText(question) || null, new Date(now).toISOString()],
  );
}

/** One vote on an answer: `delta` 1 for a reaction added, -1 for one taken back. Never below zero. Only 👍 counts: any
 *  other emoji — a 👎 left on an answer from before it was removed, or anything else — changes nothing. */
export async function vote(messageId: string, emoji: string, delta: 1 | -1 = 1, now = Date.now()): Promise<number> {
  const column = emoji === GOOD ? "up" : null;
  if (!column || !messageId) return 0;
  return run(
    `UPDATE discord_answers SET ${column} = MAX(0, ${column} + ?), voted_at = ? WHERE message_id = ?`,
    [delta, new Date(now).toISOString(), messageId],
  );
}

/** One answer's votes in the order Discord sent them: an add and its removal must not land the wrong way round — a 👍
 *  clicked and taken back within a moment would otherwise leave the answer at up = 1. Per message, so different
 *  answers never wait on each other. */
export function serialVotes(): <T>(messageId: string, work: () => Promise<T>) => Promise<T> {
  const chain = new Map<string, Promise<unknown>>();
  return <T>(messageId: string, work: () => Promise<T>): Promise<T> => {
    // Started after whatever the same answer has in flight, whether that finished or failed.
    const next = (chain.get(messageId) ?? Promise.resolve()).then(work, work);
    chain.set(messageId, next);
    void next.catch(() => {}).finally(() => { if (chain.get(messageId) === next) chain.delete(messageId); });
    return next;
  };
}

/** Every vote the bot's answers have collected. `down` is what 👎 counted before it was removed; nothing adds to it. */
export async function reactionUsage(): Promise<{ up: number; down: number }> {
  const r = await get<{ up: number; down: number }>("SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM discord_answers");
  return { up: Number(r?.up ?? 0), down: Number(r?.down ?? 0) };
}
