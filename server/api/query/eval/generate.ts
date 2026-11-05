// The search eval's question generator (docs/search-pipeline.md, "Eval"): paraphrases built from the lexicon's own
// phrases and the data's own teams, never a fixed list of queries. Each run draws a different sample (the seed says
// which, so a failure can be run again), so a phrasing the parser has never seen is tried every time.
//
// A question is a set of symbols ("agg:max" + "metric:score") and a subject (a team). Its paraphrases take every
// lexicon phrase that means exactly that symbol, the team said several ways (number, name, "team N", both), a frame
// ("what is", "show me", "?") and the team before or after the words. Every paraphrase of one question must give the
// same card.
import { LEXICON, type Sym } from "../lexicon.js";

/** A small seeded generator (mulberry32): the same seed, the same sample. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
export function sample<T>(r: () => number, xs: readonly T[], n: number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

const key = (s: Sym) => ("v" in s ? `${s.k}:${s.v}` : s.k);
/** Every phrase in the lexicon that means exactly `sym` and nothing else. */
export function phrasesFor(sym: string): string[] {
  return LEXICON.filter((e) => e.syms.length === 1 && key(e.syms[0]) === sym).map((e) => e.words.join(" "));
}

/** How a question is asked: the symbols, read in this order, each said by any phrase meaning it. A phrase that names the
 *  symbol but reads oddly in this question ("winningest score") is left out here, with the reason. */
export interface Shape { id: string; parts: string[][] }

/** The questions: what is asked, as lexicon symbols. */
export const SHAPES: Shape[] = [
  // "most", "winningest", "strongest", "record high" and "career high" mean the maximum of a count or of a strength,
  // not of a score; the parser reads "record" as the record metric, so "record high score" is two questions.
  { id: "highest-score", parts: [phrasesFor("agg:max").filter((p) => !["most", "winningest", "strongest", "record high", "career high"].includes(p)), phrasesFor("metric:score").filter((p) => !["scored", "total points"].includes(p))] },
  { id: "lowest-score", parts: [phrasesFor("agg:min").filter((p) => !["fewest", "least", "weakest"].includes(p)), phrasesFor("metric:score").filter((p) => !["scored", "total points"].includes(p))] },
  { id: "average-score", parts: [phrasesFor("agg:mean"), phrasesFor("metric:score").filter((p) => !["scored", "total points"].includes(p))] },
  { id: "record", parts: [phrasesFor("metric:record")] },
];

export interface Subject { number: number; name: string | null }
/** The ways a team is named: its number, "team" and its number, its name, and both. A name is used only when no other
 *  team has it (a shared name asks which team). */
export function teamForms(t: Subject, nameUnique: boolean): string[] {
  const n = String(t.number);
  const out = [n, `team ${n}`, `ftc ${n}`];
  if (t.name && nameUnique) out.push(t.name.toLowerCase(), `${t.name} ${n}`, `${n} ${t.name}`);
  return out;
}

const FRAMES: [string, string][] = [["", ""], ["what is", ""], ["what's", "?"], ["show me", ""], ["", "?"], ["tell me", "please"]];

/** `n` paraphrases of `shape` for team `t`, all different. */
export function paraphrases(r: () => number, shape: Shape, t: Subject, nameUnique: boolean, n: number): string[] {
  const forms = teamForms(t, nameUnique);
  const out = new Set<string>();
  for (let tries = 0; out.size < n && tries < n * 20; tries++) {
    const words = shape.parts.map((ps) => pick(r, ps)).join(" ");
    const who = pick(r, forms);
    const [pre, post] = pick(r, FRAMES);
    // The team before the words, after them, or after "of"/"for".
    const body = pick(r, [`${who} ${words}`, `${words} ${who}`, `${words} of ${who}`, `${words} for ${who}`, `${who}'s ${words}`]);
    out.add([pre, body, post].filter(Boolean).join(" ").replace(/\s+\?/, "?"));
  }
  return [...out];
}
