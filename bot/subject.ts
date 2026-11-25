// A thread's subject (bot/ask.ts): what the conversation was already about, so a follow-up that only says "their last
// meet" or "and their OPR?" is searched as the team or event the thread named instead of as a question about the word
// "their". The subject is the thread's own words — the latest message that was about the records — so a team carries
// forward by name or by number without a second lookup, and a restart keeps it with the thread (bot/handler.ts keeps the
// turns and bot/memory.ts keeps them past a deploy). A channel has one too, outside any reply thread: the last records
// question asked in it, kept by bot/memory.ts, so a follow-up in the channel means what the channel was asking about.
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

/** The words that look back at what the thread said: a pronoun, or the subject said as "that team"/"the same event".
 *  Only a message with one of these is given the thread's subject — one that names a team or event of its own doesn't
 *  need it. "It" is not one: "how does it work" is the robot, and no thread's team belongs in that question. */
const BACK = /\b(?:their|theirs|they|them|that (?:team|event|match)|the same (?:team|event)|this (?:team|event)|those|these)\b/i;

/** A team or event of its own: a record number (a team's, an event's), or an event code — letters with a digit at the
 *  end, as the short codes have (AUBRQ2, 2025-AUSYQ1) — which is what a code looks like and an all-caps word like
 *  "OPR" or "WORLDS" doesn't. A message with one of these needs no subject from the thread. */
const OWN = /(?<![\d.:])\d{2,5}(?![\d:])(?!\.\d)|\b(?:\d{4}-)?[A-Z]{2,4}[A-Z0-9]{1,4}\d\b/;

/** Whether a message looks back at the thread ("their last meet", "what about that event"). */
export const looksBack = (q: string): boolean => BACK.test(q);

/** Whether a message names a team or event of its own, so the thread's subject would be a second one. */
export const namesOwn = (q: string): boolean => OWN.test(q);

/** How long a turn may be and still be only looking back. A short "their record?" is a back-reference; the long message
 *  that first said "in the last meet they had" is a question in its own words, pronoun and all. */
const LOOK_BACK_WORDS = 6;

/** A turn that adds nothing to the thread's subject: short, and only looking back at what was already said. */
const onlyLookingBack = (text: string): boolean => BACK.test(text) && text.trim().split(/\s+/).length <= LOOK_BACK_WORDS;

/** A turn's words as a subject: its question form and punctuation dropped, so "so like what did theseus get in auto opr
 *  in the last meet they had in biobizz?" is "what did theseus get in auto opr in the last meet they had in biobizz",
 *  which search reads for the name and the thing asked. Never empty, never longer than a question. */
export function subjectOf(text: string): string {
  return text.replace(/^\s*(?:so|and|but|also|ok|okay|hey)[\s,]+/i, "").replace(/[?!.\s]+$/, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** The subject one message gives, as the words to keep: the message's own, when it was about the records and didn't
 *  only look back at them. Null when it names nothing to carry (a greeting, a build question, a bare "their record?"
 *  — which adds nothing to a subject already kept). */
export function subjectKept(text: string, about: (text: string) => boolean): string | null {
  return about(text) && !onlyLookingBack(text) ? subjectOf(text) || null : null;
}

/**
  * What the thread is about: the last thing the asker said that named something — `about` is bot/ask.ts's "this was a
  * question about the records" (a record number or a records word), and a turn that only looks back is skipped, so
  * "their record?" never becomes the subject of the next "and their OPR?". Null when the thread has said nothing of the
  * sort. Other people's turns count too: a thread is the channel's, and the subject someone else named is the one a
  * follow-up means.
 */
export function threadSubject(history: BrunoChatTurn[], about: (text: string) => boolean): string | null {
  const said = [...history].reverse().filter((t) => t.role === "user").map((t) => subjectKept(t.text, about)).find(Boolean);
  return said ?? null;
}

/**
 * The question asked as the thread's subject when it only looks back and names nothing itself: `their last meet?` in a
 * thread about Theseus' meets is `their last meet? (what did theseus get in auto opr in the last meet they had in
 * biobizz)`, whose words search can read. Null when the question needs no help — it names a team or event, or says
 * nothing that looks back — or when the thread has no subject to give.
 */
export function withSubject(q: string, subject: string | null): string | null {
  if (!subject || !looksBack(q) || namesOwn(q)) return null;
  // The thread has already said it in this very message: nothing to add.
  if (q.toLowerCase().includes(subject.toLowerCase())) return null;
  return `${q.trim()} (${subject})`.slice(0, 500);
}
