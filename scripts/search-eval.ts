// The search eval (docs/search-pipeline.md, "Eval"): questions generated from the lexicon and the data
// (server/api/query/eval/generate.ts), asked of search the way the box asks, and every card checked against the
// tables (server/api/query/eval/truth.ts). It checks:
//   - every paraphrase of one question gives the same card, for the right team
//   - the card's number is the data's (highest, lowest and average score, record)
//   - a year typed is that season; a year with no events yet says so, never the latest
//   - no place typed is no place on the card (a team's own region is never added)
//   - a place and a window typed are stated on the card, or the window relaxed and said so
//   - a matchup prediction gives a forecast with Predict open on it
//   - a misspelled name still reaches the team, or offers it
//   - every answer comes back in under the budget (1 s, warm), the 95th percentile printed beside it
// The teams are drawn at random from the season's (the seed is printed: --seed runs the same sample again).
//
//   npm run search:eval                      restores the shipped snapshot into a temp folder and runs
//   npm run search:eval -- --teams 30 --seed 7 --max 1000
//   DATABASE_URL=file:.data/scout.db npm run search:eval
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (name: string, d: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : d; };
const TEAMS = arg("teams", 12), PER = arg("per", 5), MAX = arg("max", 1000), SEED = arg("seed", Math.floor(Date.now() / 864e5));
if (!process.env.DATABASE_URL) {
  const dir = join(tmpdir(), "control-scout-search-eval");
  mkdirSync(dir, { recursive: true });
  process.env.DATABASE_URL = `file:${join(dir, "scout.db").replace(/\\/g, "/")}`;
}
const { restoreSnapshotIfEmpty } = await import("../server/data/snapshot.js");
console.log(`data: ${await restoreSnapshotIfEmpty()}`);
const { migrate } = await import("../server/db.js");
await migrate();
const { ensureSearchIndex } = await import("../server/api/search.js");
const { rebuildSearch } = await import("../server/stats/job.js");
await ensureSearchIndex(rebuildSearch);
const { names, fold } = await import("../server/api/query/names.js");
const { forecasterFor } = await import("../server/predict/engine.js");
const { CURRENT_SEASON } = await import("../server/data/seasons.js");
const { refreshSearchSeason } = await import("../server/api/answers/season.js");
const { searchAnswer } = await import("../server/api/searchAnswer.js");
const { seasonLabel } = await import("../src/shared/format.js");
const { SHAPES, paraphrases, rng, sample, pick } = await import("../server/api/query/eval/generate.js");
const { teamTruth, teamsPlayed, opponentsOf } = await import("../server/api/query/eval/truth.js");
type Answer = Awaited<ReturnType<typeof searchAnswer>>;

const index = await names();
const season = await refreshSearchSeason();
// The engine's ratings, as the server loads them at start: a matchup's call needs them.
await forecasterFor(CURRENT_SEASON);
await forecasterFor(season);
const r = rng(SEED);
const times: number[] = [];
const timed: [number, string][] = [];
const failures: string[] = [];
let asked = 0, checks = 0;
const ask = async (q: string): Promise<Answer> => {
  const t = performance.now();
  const a = await searchAnswer(q, { learn: false, limit: 12, full: true });
  times.push(performance.now() - t);
  timed.push([performance.now() - t, q]);
  asked++;
  return a;
};
const check = (ok: boolean, what: string) => { checks++; if (!ok) failures.push(what); return ok; };
const card = (a: Answer) => `${a.stat?.title ?? a.card?.title ?? a.understood?.label ?? "(no card)"} = ${a.stat?.headline?.value ?? a.stat?.none ?? "–"}`;
// A chip that names a place the query never typed.
const placeChip = (a: Answer, typed: string) => (a.stat?.scope ?? []).find((c) => { const p = index.place(fold(c), c); return p && !fold(typed).includes(fold(p.name)); });

// Warm the readers so the times are the warm path the budget is for.
for (const q of ["1 record", "2 highest score"]) await searchAnswer(q, { learn: false, limit: 12, full: true });

const pool = (await teamsPlayed(season)).filter((t) => index.team(t.number));
const teams = sample(r, pool, TEAMS);
console.log(`seed ${SEED} · season ${seasonLabel(season)} · ${teams.length} of ${pool.length} teams · ${PER} paraphrases per question`);

for (const t of teams) {
  const truth = await teamTruth(t.number, season);
  if (!truth) continue;
  for (const shape of SHAPES) {
    const qs = paraphrases(r, shape, t, t.unique, PER);
    const as: Answer[] = [];
    for (const q of qs) as.push(await ask(q));
    const want = shape.id === "record" ? [`${truth.wins}-${truth.losses}-${truth.ties}`]
      : shape.id === "average-score" ? [truth.avg.toFixed(1)]
      : (shape.id === "highest-score" ? truth.high : truth.low).map((s) => `${s} points`);
    as.forEach((a, i) => {
      const q = qs[i];
      if (!check(a.stat?.team?.number === t.number, `${shape.id} · "${q}": wrong team or no card (${card(a)})`)) return;
      check(want.includes(String(a.stat?.headline?.value)), `${shape.id} · "${q}": ${a.stat?.headline?.value ?? a.stat?.none} but the data says ${want.join(" or ")}`);
      const chip = placeChip(a, q);
      check(!chip, `place · "${q}": the card adds a place nobody typed (${chip})`);
    });
    const cards = new Set(as.filter((a) => a.stat).map((a) => `${a.stat!.title} = ${a.stat!.headline?.value}`));
    check(cards.size <= 1, `same card · ${shape.id} for ${t.number}: ${[...cards].join(" | ")} (${qs.join(" / ")})`);
  }
  // A year typed: that season; a year with no events yet: said so.
  const before = await teamTruth(t.number, season - 1);
  if (before) {
    const q = `${t.number} record ${season - 1}`, a = await ask(q);
    check(a.stat?.title === `Record in ${seasonLabel(season - 1)}` && a.stat?.headline?.value === `${before.wins}-${before.losses}-${before.ties}`, `year · "${q}": ${card(a)}, the data says ${before.wins}-${before.losses}-${before.ties}`);
  }
  const future = new Date().getUTCFullYear() + 2;
  const fa = await ask(`${t.number} record ${future}`);
  check(!!fa.stat?.title?.startsWith("No ") && !fa.stat?.headline, `future year · "${t.number} record ${future}": ${card(fa)}`);
  // A place and a window: stated, or relaxed and said so.
  const place = (t.state && index.place(t.state, t.state)) || (t.country && index.place(t.country)) || null;
  if (place && place.kind !== "city") {
    const q = `${pick(r, ["highest scoring match", "best score", "top score", "highest score"])} in ${place.name} ${pick(r, ["this week", "this weekend", "last week"])}`;
    const a = await ask(q);
    const scope = a.stat?.scope ?? [];
    if (check(!!a.stat, `window · "${q}": no card (${card(a)})`)) {
      check(scope.some((c) => fold(c).includes(fold(place.name))), `window · "${q}": the place isn't stated (${scope.join(", ")})`);
      check(!a.stat!.headline || scope.some((c) => /^Relaxed: /.test(c)) || /week/.test(a.stat!.title + scope.join(" ")), `window · "${q}": the time isn't stated (${a.stat!.title}; ${scope.join(", ")})`);
    }
  }
  // A matchup: a forecast, with Predict open on it.
  const opp = await opponentsOf(t.number, season);
  if (opp) {
    const q = pick(r, [`${t.number} vs ${opp} prediction`, `who would win ${t.number} vs ${opp}`, `${t.number} versus ${opp} odds`, `predict ${t.number} against ${opp}`]);
    const a = await ask(q);
    // The winner, both scores and the odds, and Predict opened on these two teams.
    const h = a.stat?.headline;
    const links = [...a.pages, ...(a.stat?.blocks ?? []).flatMap((b) => (b.kind === "links" ? b.items.map((i) => ({ title: i.label, href: i.href })) : []))];
    const open = links.some((l) => /^Open in Predict/.test(l.title) && l.href.includes(`red=${t.number}`) && l.href.includes(`blue=${opp}`));
    check(!!h && /favoured|rated higher|even/i.test(String(h.value)) && /\d+% to win · predicted \d+–\d+/.test(String(h.label)) && open, `matchup · "${q}": ${card(a)} · ${h?.label ?? ""}; links ${links.map((l) => l.title).join(", ")}`);
  }
  // A misspelled name: one letter dropped from its longest word.
  if (t.name && t.unique) {
    const words = t.name.split(/\s+/), long = words.reduce((x, y) => (y.length > x.length ? y : x));
    if (long.length >= 6) {
      const i = 1 + Math.floor(r() * (long.length - 2));
      const typo = words.map((w) => (w === long ? w.slice(0, i) + w.slice(i + 1) : w)).join(" ").toLowerCase();
      const a = await ask(`${typo} record`);
      const reached = a.stat?.team?.number === t.number || a.hits.slice(0, 3).some((h) => h.ref === `team:${t.number}`) || !!a.didYouMean?.toLowerCase().includes(long.toLowerCase());
      check(reached, `misspelled · "${typo} record" (${t.name}): ${card(a)}; did you mean ${a.didYouMean ?? "–"}`);
    }
  }
}

times.sort((a, b) => a - b);
const p95 = times[Math.floor(0.95 * (times.length - 1))] ?? 0;
const slowest = times[times.length - 1] ?? 0;
check(slowest < MAX, `latency · slowest answer ${slowest.toFixed(0)} ms over the ${MAX} ms budget`);
console.log(`${asked} questions · ${checks} checks · ${failures.length} failed · p50 ${(times[Math.floor(times.length / 2)] ?? 0).toFixed(0)} ms · p95 ${p95.toFixed(0)} ms · slowest ${slowest.toFixed(0)} ms`);
console.log(`slowest: ${timed.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([ms, q]) => `${q} ${ms.toFixed(0)} ms`).join(" · ")}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `Run again with --seed ${SEED}.` : "All checks passed.");
process.exit(failures.length ? 1 : 0);
