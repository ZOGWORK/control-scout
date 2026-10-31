// Walk-forward replay of past playoffs through the bracket predictor (src/shared/bracketOdds.ts): how often
// the favourite wins a series, the series calls' Brier score, and whether the championship odds are
// calibrated. No hindsight: before every series' first match, the ratings are the season replayed from
// every earlier match only (this event's quals and earlier playoff series included, as live), and the
// bracket is conditioned on the playoff results posted by then.
//
//   npm run bracket:replay -- [season …] [--runs N] [--events N] [--write]
//
// --write regenerates src/shared/bracketAccuracy.ts (the line the Playoffs tab shows) from this run.
import "../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, explainMatch, type EventRecord, type MatchRecord, type RatingBook } from "@control-scout/predict-engine";
import { all, migrate } from "../server/db.js";
import { forecasterFor } from "../server/predict/engine.js";
import { bracketAlliances } from "../server/api/bracket.js";
import { bracketOdds, type BracketAlliance, type BracketMatch, type BracketOdds } from "../src/shared/bracketOdds.js";
import { textSeed } from "../src/shared/projectionCore.js";

await migrate();
const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const seasons = args.filter((a, i) => /^\d{4}$/.test(a) && !args[i - 1]?.startsWith("--")).map(Number);
if (!seasons.length) seasons.push(2023, 2024, 2025);
const runs = Number(flag("--runs") ?? 2000);
const maxEvents = Number(flag("--events") ?? Infinity);

interface SeriesCall { season: number; format: string; p: number; won: boolean; seedFavWon: boolean; first: boolean }
interface ChampPoint { season: number; p: number; won: boolean; pre: boolean }
const calls: SeriesCall[] = [];
const champs: ChampPoint[] = [];
let events = 0, unknown = 0, unfinished = 0;
const t0 = performance.now();

const toBracket = (m: MatchRecord, posted: boolean): BracketMatch => ({
  series: m.series, number: m.number, red: m.red.teams, blue: m.blue.teams,
  redScore: posted ? m.red.total : null, blueScore: posted ? m.blue.total : null,
});

for (const season of seasons) {
  const f = await forecasterFor(season);
  const rows = await all<any>("SELECT * FROM alliances WHERE season = ? ORDER BY code, number", [season]);
  const allianceBy = new Map<string, BracketAlliance[]>();
  for (const r of rows) allianceBy.set(r.code, [...(allianceBy.get(r.code) ?? []), ...bracketAlliances([r])]);
  const evs = f.seasonEvents(season).filter((e) => allianceBy.has(e.code) && e.matches.some((m) => m.level === "playoff")).slice(0, maxEvents);
  // One task per series start: the moment just before its first match.
  const tasks: { t: number; ev: EventRecord; alliances: BracketAlliance[]; playoffs: MatchRecord[]; series: number; first: boolean }[] = [];
  for (const ev of evs) {
    const alliances = allianceBy.get(ev.code)!.filter((a) => a.teams.length);
    const playoffs = ev.matches.filter((m) => m.level === "playoff").sort((x, y) => x.time - y.time || x.series - y.series || x.number - y.number);
    const seen = new Set<number>();
    for (const m of playoffs) {
      if (seen.has(m.series)) continue;
      tasks.push({ t: m.time, ev, alliances, playoffs, series: m.series, first: seen.size === 0 });
      seen.add(m.series);
    }
  }
  // The real outcome per event: the bracket with every result posted.
  const final = new Map<string, BracketOdds>();
  const finalOf = (ev: EventRecord, alliances: BracketAlliance[], playoffs: MatchRecord[]) => {
    let o = final.get(ev.code);
    if (!o) {
      o = bracketOdds({ season, alliances, matches: playoffs.map((m) => toBracket(m, true)), price: () => ({ p: 0.5, tier: "confident" }), strength: () => null, runs: 1, seed: 1 });
      final.set(ev.code, o);
      events++;
      if (o.format === "unknown") unknown++;
      else if (!o.alliances.some((a) => a.status === "champion")) unfinished++;
    }
    return o;
  };
  const byTime = new Map<number, typeof tasks>();
  for (const k of tasks) byTime.set(k.t, [...(byTime.get(k.t) ?? []), k]);
  f.replayTo(season, [...byTime.keys()], (t: number, book: RatingBook) => {
    for (const k of byTime.get(t)!) {
      const truth = finalOf(k.ev, k.alliances, k.playoffs);
      const price = (a: number[], b: number[]) => {
        const x = explainMatch(book, a, b, {
          noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, shadow: FITTED_MODEL.contextual?.fallback, band: FITTED_MODEL.band,
          context: { level: "playoff", event: k.ev.code, ...(k.ev.region ? { region: k.ev.region } : {}) },
        });
        return { p: x.winProbA, tier: x.confidence.tier };
      };
      const strength = (team: number) => (book.ratings.has(team) ? book.allianceExpectation([team], "playoff").np : null);
      // What was posted by then: results of earlier matches, and the line-up of the series starting now. Later
      // series' line-ups weren't known yet (they name who got there), so they're left out.
      const posted = k.playoffs.filter((m) => m.time < t || m.series === k.series || m.time === t).map((m) => toBracket(m, m.time < t));
      const o = bracketOdds({ season, alliances: k.alliances, matches: posted, price, strength, runs, seed: textSeed(`${season}|${k.ev.code}|${t}`) });
      // The series starting now: its call, against who really won it.
      const view = o.series.find((s) => s.series === k.series && !s.skipped);
      const real = truth.series.find((s) => s.series === k.series);
      if (view?.call && real?.winner != null && view.red.alliance != null && view.blue.alliance != null) {
        const higherSeed = Math.min(view.red.alliance, view.blue.alliance);
        calls.push({ season, format: o.format, p: view.call.p, won: view.call.alliance === real.winner, seedFavWon: higherSeed === real.winner, first: view.index <= (o.format === "double" ? Math.floor(k.alliances.length / 2) : o.format === "classic" ? 2 : 1) });
      }
      // Championship odds against the real champion, where the bracket finished.
      const champ = truth.alliances.find((a) => a.status === "champion")?.alliance;
      if (o.format !== "unknown" && truth.format !== "unknown" && champ != null) {
        for (const a of o.alliances) if (a.status === "alive") champs.push({ season, p: a.pChampion, won: a.alliance === champ, pre: k.first });
      }
    }
  });
  console.error(`${season}: ${evs.length} events, ${tasks.length} series starts (${Math.round((performance.now() - t0) / 1000)} s)`);
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const summary = (xs: SeriesCall[]) => ({
  n: xs.length,
  accuracy: r3(xs.filter((c) => c.won).length / xs.length),
  brier: r3(xs.reduce((s, c) => s + (c.p - Number(c.won)) ** 2, 0) / xs.length),
  higherSeedAccuracy: r3(xs.filter((c) => c.seedFavWon).length / xs.length),
});
const bins = [0, 0.05, 0.15, 0.3, 0.5, 0.7, 1.0001];
const calibration = (xs: ChampPoint[]) => bins.slice(0, -1).map((lo, i) => {
  const b = xs.filter((c) => c.p >= lo && c.p < bins[i + 1]);
  return { from: lo, to: Math.min(1, bins[i + 1]), n: b.length, predicted: b.length ? r3(b.reduce((s, c) => s + c.p, 0) / b.length) : null, actual: b.length ? r3(b.filter((c) => c.won).length / b.length) : null };
});
const champSummary = (xs: ChampPoint[]) => ({ n: xs.length, brier: r3(xs.reduce((s, c) => s + (c.p - Number(c.won)) ** 2, 0) / xs.length), calibration: calibration(xs) });
// Pre-playoff favourite: the alliance with the top championship odds at each event's first snapshot.
const report = {
  seasons, runs, events, unknownFormat: unknown, unfinished,
  series: { all: summary(calls), firstRound: summary(calls.filter((c) => c.first)), later: summary(calls.filter((c) => !c.first)), bySeason: Object.fromEntries(seasons.map((s) => [s, summary(calls.filter((c) => c.season === s))])), byFormat: Object.fromEntries(["double", "final", "classic", "unknown"].map((fm) => [fm, summary(calls.filter((c) => c.format === fm))]).filter(([, x]) => (x as { n: number }).n)) },
  championship: { prePlayoffs: champSummary(champs.filter((c) => c.pre)), everySeriesStart: champSummary(champs) },
  seconds: Math.round((performance.now() - t0) / 1000),
};
console.log(JSON.stringify(report, null, 2));

if (args.includes("--write")) {
  const s = report.series.all, c = report.championship.prePlayoffs;
  writeFileSync("src/shared/bracketAccuracy.ts", `// Generated by \`npm run bracket:replay -- --write\` (scripts/bracket-replay.ts): the bracket predictor's measured
// accuracy on past playoffs, replayed walk-forward. Regenerate after an engine or bracket change.
export const BRACKET_ACCURACY = {
  seasons: [${seasons.join(", ")}],
  /** Series calls: how many, how often the favourite won, Brier score, and how often the higher seed won (the naive call). */
  series: { n: ${s.n}, accuracy: ${s.accuracy}, brier: ${s.brier}, higherSeedAccuracy: ${s.higherSeedAccuracy} },
  /** Championship odds before the first playoff match: alliance-events scored and Brier score. */
  championship: { n: ${c.n}, brier: ${c.brier} },
} as const;
`);
  console.error("wrote src/shared/bracketAccuracy.ts");
}
process.exit(0);
