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

/** Whether these words are short enough to be a greeting rather than a question search couldn't answer. */
export const shortEnough = (q: string) => q.trim().split(/\s+/).filter(Boolean).length <= SMALL_TALK_WORDS;

/** The bot's one fallback for a short message, or null: a real question (a number in it), or a long one. */
export function smallTalk(q: string): string | null {
  const t = q.trim().replace(/\s+/g, " ");
  if (!t || !shortEnough(t)) return null;
  // A number is a team, a season or a score: that's a records question however short ("6980", "2025 worlds").
  if (/\d/.test(t)) return null;
  return NO_CHAT;
}
