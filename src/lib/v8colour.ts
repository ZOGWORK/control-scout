// v8's colour vocabulary: the few colours that carry meaning, the same everywhere so people learn them. Text and
// thin accents only (no filled panels). All `v8:` classes, so the classic look (/legacy) never sees them.
// Tailwind only generates classes it can read written out, so every string here is literal.
//
// - What you looked for (a page's headline number): the slate-blue accent, `V8_NUM` in lib/v8.ts.
// - Alliances: the `--color-*-alliance` tokens (text-red-alliance / text-blue-alliance), never faded.
// - Outcome: won / right / rising green, lost / upset / falling red, tied / steady a neutral grey.
//   (The shared success token is green too, including Right badges.)
// - Stat categories: purple OPR / rating, blue Auto, orange TeleOp (DC), green Endgame, red Penalty: `V8_PHASE` /
//   `V8_CATEGORY` in lib/records/describe.ts.
// - Awards gold; ranks #1 gold, #2 silver, #3 bronze.

/** Won, Right, rising, a positive change. */
export const V8_WIN = "v8:text-emerald-400";
/** Lost, Upset, falling, a negative change. */
export const V8_LOSS = "v8:text-rose-400";

/** Award icon and name. */
export const V8_AWARD = "v8:text-yellow-400";


/** A place's colour: gold, silver, bronze for the top three; nothing (white) otherwise. */
export function v8Rank(rank: number | null | undefined): string | undefined {
  return rank === 1 ? "v8:text-yellow-400" : rank === 2 ? "v8:text-slate-300" : rank === 3 ? "v8:text-amber-600" : undefined;
}
