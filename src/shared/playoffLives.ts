// Double-elimination lives: in a double-elimination playoff each alliance can lose twice before it is out. For every
// playoff match, each side's lives as it came into the match and after it, read off the event's posted results in
// bracket order (never from a match's name). Only for a double-elimination bracket (bracketShape's "double": the
// 2024–25 rules on, 4, 6 or 8 alliances); best-of-3 finals, the old semifinal brackets and anything that doesn't fit
// get none. The grand final needs no rule of its own: the upper-bracket alliance arrives with 2 lives, the lower
// one with 1, as the results before it leave them.
//
// Alliances are read from who played together: teams on one side of any playoff match are one alliance (a third
// robot or a backup joins its alliance the first time it plays). Pure: the server adds it to each match view.
import { bracketShape } from "./bracketOdds.js";

/** One posted playoff match, as the lives read it. Scores are totals (penalties included: they decide the match). */
export interface LivesMatch { series: number; number: number; red: number[]; blue: number[]; played: boolean; redScore: number | null; blueScore: number | null }

/** A side's lives coming into the match and after it (after < before: this match took one). `final`: only these two
 *  alliances are left in the bracket. */
export interface SideLives { before: number; after: number; final?: boolean }
export interface MatchLives { red: SideLives; blue: SideLives }

/** Lives each alliance starts a double-elimination playoff with. */
export const LIVES = 2;

/** Each playoff match's lives by "series:number", empty when the event's playoff isn't double-elimination. */
export function playoffLives(season: number, matches: LivesMatch[]): Map<string, MatchLives> {
  const out = new Map<string, MatchLives>();
  // The alliances: teams joined by playing on one side together.
  const parent = new Map<number, number>();
  const find = (t: number): number => { let r = t; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(t, r); return r; };
  const join = (ts: number[]) => {
    for (const t of ts) if (!parent.has(t)) parent.set(t, t);
    for (const t of ts.slice(1)) { const a = find(ts[0]), b = find(t); if (a !== b) parent.set(b, a); }
  };
  for (const m of matches) { join(m.red); join(m.blue); }
  const allianceOf = (ts: number[]) => (ts.length ? find(ts[0]) : null);
  const alliances = new Set([...parent.keys()].map(find));
  const shape = bracketShape(season, alliances.size, matches.map((m) => m.series));
  if (shape?.format !== "double") return out;

  const losses = new Map<number, number>();
  const left = (a: number) => LIVES - (losses.get(a) ?? 0);
  for (const m of [...matches].sort((x, y) => x.series - y.series || x.number - y.number)) {
    const red = allianceOf(m.red), blue = allianceOf(m.blue);
    // A slot not filled yet (a later round before its alliances are known): nothing to say.
    if (red == null || blue == null || red === blue) continue;
    const alive = [...alliances].filter((a) => left(a) > 0).length;
    const before = { red: left(red), blue: left(blue) };
    const decided = m.played && m.redScore != null && m.blueScore != null && m.redScore !== m.blueScore;
    // A tie is replayed: nobody loses a life.
    const loser = !decided ? null : m.redScore! < m.blueScore! ? red : blue;
    if (loser != null) losses.set(loser, (losses.get(loser) ?? 0) + 1);
    const final = alive === 2 ? { final: true } : {};
    out.set(`${m.series}:${m.number}`, {
      red: { before: before.red, after: left(red), ...final },
      blue: { before: before.blue, after: left(blue), ...final },
    });
  }
  return out;
}

/** What a side's hearts say, for its label and title. */
export function livesLabel(l: SideLives): string {
  if (l.after < l.before) {
    if (l.after === 0) return "Lost its last life this match: eliminated";
    return l.final ? "Lost a life this match: the final is played again" : "Lost a life this match: down to the lower bracket";
  }
  if (l.after <= 0) return "Eliminated";
  return `${l.after} ${l.after === 1 ? "life" : "lives"} left`;
}
