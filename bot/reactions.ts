// The quality signal on an answer: 👍 and 👎 reactions, counted (migration 104). The bot adds both to every answer it
// posts; a click is a count on that answer, never a record of who clicked (no user id is kept), so the owner console can
// see whether answers land at all.
//
// Only messages the bot posted have a row (trackAnswer), so a reaction on anything else is ignored: nobody can inflate a
// number by reacting in a channel the bot was never in.
//
// The row keeps the question the answer was given for (migration 105), so a 👎 can name it: a downvote says the answer
// was wrong rather than missing, which search can't see for itself (it called the answer answered). The answer's first
// 👎 files that question in the site's failed-search queue (server/searchFailures.ts `downvoteFailure`), in the same
// batch as the vote itself.
import { get, run, writeBatch } from "../server/db.js";
import { downvoteFailure } from "../server/searchFailures.js";
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

/** A 👎 added to an answer: counted, and on the answer's first one the question it answered is filed in the site's
 *  failed-search queue — the count and the filing in one batch, which is one transaction, so a restart can't spend the
 *  filing without making it and two 👎 can't make it twice. A later 👎 on the same answer is counted, not filed again:
 *  it is the same complaint about the same question.
 *
 *  The vote is written even when there is nothing to file (a message the bot never posted has no row; an answer from
 *  before questions were kept has none; an all-personal question has nothing the queue may hold). Returns whether this
 *  vote filed the question — what the channel is told a 👎 does (bot/index.ts) is read from the write, so it is said
 *  only when something was actually filed. */
export async function downVote(messageId: string, now = Date.now()): Promise<{ filed: boolean }> {
  if (!messageId) return { filed: false };
  const at = new Date(now).toISOString();
  // Read first for the words; the filing's own condition (`down` = 1) is what says "first", inside the same batch as
  // the increment, so this read can be a moment stale without two votes both filing.
  const row = await get<{ question: string | null }>("SELECT question FROM discord_answers WHERE message_id = ?", [messageId]);
  if (!row) return { filed: false };
  const failure = row.question ? downvoteFailure(row.question, messageId, now) : null;
  const [, filed] = await writeBatch([
    { sql: "UPDATE discord_answers SET down = down + 1, voted_at = ? WHERE message_id = ?", args: [at, messageId] },
    ...(failure ? [failure] : []),
  ]);
  // The filing's own condition (`down` = 1) is inside the batch: this is what the write did, not what a count said
  // before it. Two 👎 arriving together file once, so exactly one of them reports it.
  return { filed: (filed?.rowsAffected ?? 0) > 0 };
}

/** What a 👎 does, said once per answer in the channel (bot/index.ts): people were using it as a dislike button, and
 *  every one of them files the question on the list the team works from. One line, sent as a reply to the answer, so
 *  the button explains itself at the moment it is used. */
export const DOWN_NOTE = "📝 Noted — a 👎 files this question so we can fix the answer. It's not a dislike button.";

/** What the 👎 notes remember: the answers a channel has been told about, and the ones it owes a note that never
 *  reached a channel. Saved (bot/index.ts) so a restart neither says it twice nor drops it. */
export interface DownNoteState { told: string[]; owed: string[] }

/** Which answers' channels have been told what a 👎 does, and whether this vote owes the note (bot/index.ts).
 *
 *  The note is due when the vote filed the question — `due` is handed `downVote`'s own answer, so an answer from before
 *  questions were kept, or one whose question is all personal, says nothing instead of promising a filing that never
 *  happened — and again on any later 👎 if the note couldn't be delivered: a channel that wouldn't take the message, or
 *  a send Discord refused, leaves it owed rather than spent. Every change is saved through `save`, so a restart picks
 *  the sets up again ('hydrate'); the answers already told are capped at `max`, past which the oldest is forgotten and a
 *  vote taken off and added again on it can say the note once more — a repeat, never a missing one. */
export function downNotes(max = 500, save: (state: DownNoteState) => void = () => {}) {
  const told = new Set<string>();
  const owed = new Set<string>();
  const keep = () => save({ told: [...told], owed: [...owed] });
  return {
    /** Take up what an earlier run saved (a restart, a deploy), added to what this run already knows: loading is
     *  asynchronous, so a 👎 can be answered before it finishes, and that note must not be forgotten (or owed again). */
    hydrate(state: DownNoteState): void {
      for (const id of state.told ?? []) if (typeof id === "string") told.add(id);
      for (const id of state.owed ?? []) if (typeof id === "string") owed.add(id);
      // Said beats owed, whichever run said it.
      for (const id of told) owed.delete(id);
      while (told.size > max) told.delete(told.values().next().value!);
      while (owed.size > max) owed.delete(owed.values().next().value!);
      // Saved again as merged: a note answered before the load queued a snapshot of its own, and this one must land
      // after it rather than the merged state living only in memory until the next vote.
      keep();
    },
    /** Whether this vote owes the note: it filed the question, or an earlier vote's note never arrived. */
    due(messageId: string, filed: boolean): boolean {
      return !told.has(messageId) && (filed || owed.has(messageId));
    },
    /** It reached the channel: never again for this answer. */
    said(messageId: string): void {
      owed.delete(messageId);
      told.add(messageId);
      if (told.size > max) told.delete(told.values().next().value!);
      keep();
    },
    /** It couldn't be delivered: the next 👎 on this answer tries again, and a restart still owes it. Bounded like
     *  `told`: past `max` owed notes the oldest is forgotten — a courtesy line nobody asked for again, while the vote
     *  and the filing it made are untouched. */
    unsent(messageId: string): void {
      if (told.has(messageId)) return;
      owed.add(messageId);
      if (owed.size > max) owed.delete(owed.values().next().value!);
      keep();
    },
  };
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

/** One answer's votes in the order Discord sent them. An add and its removal must not land the wrong way round — a 👎
 *  clicked and taken back within a moment would otherwise leave the answer at down = 1, and file a vote nobody holds —
 *  and the filing must follow the count it belongs to. Per message, so different answers never wait on each other. */
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

/** Every vote the bot's answers have collected. */
export async function reactionUsage(): Promise<{ up: number; down: number }> {
  const r = await get<{ up: number; down: number }>("SELECT COALESCE(SUM(up), 0) AS up, COALESCE(SUM(down), 0) AS down FROM discord_answers");
  return { up: Number(r?.up ?? 0), down: Number(r?.down ?? 0) };
}
