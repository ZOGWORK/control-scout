// How hard one Discord answer may work a question out. The loop that runs the steps is `talk` in bot/ask.ts; these live
// here so the note Bruno reads (bot/productFacts.ts's lookupNote) is built from the same numbers the loop uses, and a
// prompt that says one thing while the code does another can't happen.
/** The wall-clock time one answer may spend in the loop, its searches and correction round included. It caps the wait,
 *  never the work: an answer takes as many steps and runs as many searches as it needs, and only the clock stops it. A
 *  slow model at one call's 45 s ceiling would otherwise hold the channel for minutes. Past this he posts what he
 *  already said. */
export const AGENT_BUDGET_MS = 120_000;
/** The least time worth starting one more model call with: with less left than this the call would only time out, so
 *  the loop stops and the answer posts instead. */
export const MIN_CALL_MS = 5_000;
