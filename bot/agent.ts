// How hard one Discord answer may work a question out. The loop that runs the steps is `talk` in bot/ask.ts; these live
// here so the note Bruno reads (bot/productFacts.ts's lookupNote) is built from the same numbers the loop uses, and a
// prompt that says one thing while the code does another can't happen.
/** The steps of one answer's loop: a reply may look something up, the facts come back, and he replies again. One step
 *  answers most records questions; a message asking several things, or a follow-up that turns out to need another
 *  subject, can take two or three. */
export const AGENT_STEPS = 3;
/** The searches one step may ask for: a reply that asks three things has all three run, not the first two. */
export const QUERIES_PER_STEP = 3;
/** The wall-clock time one answer may spend in the loop, its searches and correction round included. The steps alone
 *  bound the work but not the wait: three steps of a slow model at one call's 45 s ceiling would hold the channel for
 *  minutes. Past this he posts what he already said. */
export const AGENT_BUDGET_MS = 120_000;
/** The least time worth starting one more model call with: with less left than this the call would only time out, so
 *  the loop stops and the answer posts instead. */
export const MIN_CALL_MS = 5_000;
