// One honest fallback, not a personality.
//
// A short message that isn't a records question ("hi", "who's your favourite person here", "thanks") deserves an
// answer, but not a canned one. When the model's chat (Control Point's Bruno) is off, unconfigured, failing or slow
// and search found nothing either, the bot says that in one plain line: it can't chat right now, and it can still
// read the records. Nothing here claims a favourite, an opinion or a fact, so nothing can be read as data.
//
// Before this file held a keyword table (a greeting, a thank-you, a joke, a goodbye…), each in the bot's "voice".
// In a channel that read as a script rather than a bot that wasn't listening — and the one thing it never said was
// that the AI wasn't reachable. One line says it every time.

/** How many words a message may have and still be small talk: a longer one that no chat answered is a real
 *  question, and keeps the honest "can't answer that" card with its suggestions. */
export const SMALL_TALK_WORDS = 12;

/** The one reply when no model answered and search found nothing: what's wrong (plainly), and what still works. */
export const NO_CHAT =
  "I can't chat right now — my AI answers aren't reachable, so I can only go by the records. Ask me about a team, an event or a match.";

/** The same fallback for a chat that is there and gave nothing about this one message (a reply with a number the facts
 *  don't have, an empty one, a failure): the model isn't missing, so it says only that this message got no answer.
 *  Saying its AI is unreachable would contradict the answer it posted a moment earlier in the same channel, and send
 *  whoever reads it looking for a broken deployment. */
export const NO_REPLY = "I didn't get an answer to that one — ask me about a team, an event or a match.";

/** Whether these words are short enough to be a greeting rather than a question search couldn't answer. */
export const shortEnough = (q: string) => q.trim().split(/\s+/).filter(Boolean).length <= SMALL_TALK_WORDS;

/** A number that could be a record: a team, a match, a score or a season. Not a ratio ("42:15", "1:1") and not a
 *  measurement ("12.4 OPR", "1.5 in"): a build question is full of those, and it asks nothing of the records. */
export const RECORD_NUMBER = /(?<![\d.:])\d{2,5}(?![\d:])(?!\.\d)/;

/** A build question: a ratio ("42:15", "1:1") or the parts around one. It asks nothing of the records, so search's
 *  guess at a team is worth nothing to it: the screenshot's "should I use a 42:15 gear reduction on my robot turret"
 *  was answered "Sorry — I can't answer that yet. I read it as: Team 12499 Gear Up", which is worse than one plain
 *  line saying this one got no answer. */
export const MECHANISM = /\b\d+(?:\.\d+)?\s*:\s*\d+\b|\b(?:gear|gears|gearing|ratio|reduction|turret|motor|motors|rpm|sprocket|chain|belt|drivetrain|intake|flywheel|servo|encoder|axle|chassis)\b/i;

/** The bot's one fallback for a short message, or null: a real question (a record number in it), or a long one —
 *  unless it's a build question, which is never one about the records however long it is.
 *  `reachable`: the chat is wired, configured and switched on, so it answered other messages and this one alone got
 *  nothing back (bot/ask.ts works that out); it is then described as that, never as missing. */
export function smallTalk(q: string, reachable = false): string | null {
  const t = q.trim().replace(/\s+/g, " ");
  if (!t) return null;
  // A team, a season or a score is a records question however short ("6980", "2025 worlds"): its own card.
  if (RECORD_NUMBER.test(t)) return null;
  // A build question is not: one plain line, however long it is.
  if (!MECHANISM.test(t) && !shortEnough(t)) return null;
  return reachable ? NO_REPLY : NO_CHAT;
}
