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
 *  before questions were kept has none; an all-personal question has nothing the queue may hold). */
export async function downVote(messageId: string, now = Date.now()): Promise<{ counted: boolean; filed: boolean; fileable: boolean }> {
  const nothing = { counted: false, filed: false, fileable: false };
  if (!messageId) return nothing;
  const at = new Date(now).toISOString();
  // Read for the words to file. They are the answer's own and never change, so this read can't be stale in a way that
  // matters; what the vote itself did comes back from the writes, not from this row's counts.
  const row = await get<{ question: string | null }>("SELECT question FROM discord_answers WHERE message_id = ?", [messageId]);
  const failure = row?.question ? downvoteFailure(row.question, messageId, now) : null;
  const [counted, filed] = await writeBatch([
    { sql: "UPDATE discord_answers SET down = down + 1, voted_at = ? WHERE message_id = ?", args: [at, messageId] },
    ...(failure ? [failure] : []),
  ]);
  return {
    counted: (counted?.rowsAffected ?? 0) > 0,
    // The filing's own condition (`down` = 1) is inside the batch, so this is whether the question went in *now*: a
    // second 👎 on the same answer, or two arriving together, reports 0.
    filed: (filed?.rowsAffected ?? 0) > 0,
    // Whether there were words the queue could take at all: an answer with no question, or an all-personal one, has
    // nothing to file rather than something already filed.
    fileable: !!failure,
  };
}

/** A reaction as the gateway hands it over: the emoji, and the message it is on. */
export interface VoteReaction { emoji: { name: string | null }; message: { id: string } }

/** The bot's answer votes, as the gateway's two events use them (bot/index.ts): one answer's votes in the order Discord
 *  sent them (an add and its removal must not land the wrong way round), and every outcome as one line — a vote that
 *  counts nothing is then answerable from the journal instead of disappearing in a caught error. */
export function voteHandlers(log: (m: string) => void = () => {}) {
  const serial = serialVotes();
  /** One vote, as a line for the log. */
  async function cast(delta: 1 | -1, messageId: string, emoji: string): Promise<string> {
    const said = `${emoji} ${delta > 0 ? "on" : "off"} …${messageId.slice(-6)}`;
    if (emoji === BAD && delta === 1) {
      const o = await downVote(messageId);
      if (!o.counted) return `${said}: not an answer of mine, nothing counted`;
      if (o.filed) return `${said}: counted, its question filed`;
      return `${said}: counted, ${o.fileable ? "its question is already in" : "nothing to file"}`;
    }
    // `vote` reports the row it changed: 0 is a message the bot never posted.
    return (await vote(messageId, emoji, delta)) ? `${said}: counted` : `${said}: not an answer of mine, nothing counted`;
  }
  const handler = (delta: 1 | -1) => (reaction: VoteReaction, user: { bot?: boolean }): void => {
    // The bot's own reactions (it adds both to every answer) are not votes, and neither is any other emoji.
    if (user.bot) return;
    const emoji = reaction.emoji.name;
    if (emoji !== GOOD && emoji !== BAD) return;
    void serial(reaction.message.id, () => cast(delta, reaction.message.id, emoji))
      .then(log, (e) => log(`vote failed: ${(e as Error)?.message ?? String(e)}`));
  };
  return { added: handler(1), removed: handler(-1) };
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
