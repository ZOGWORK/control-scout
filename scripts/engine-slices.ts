// Engine error report (Prediction Engine program, Part 1): replays the pinned
// corpus in strict chronological order through the engine exactly as the
// backtest ledger does (server/stats/job.ts backtest: same loader, same
// exclusions, same order, same options), tags every predicted match, and
// writes accuracy / Brier / log loss / calibration per slice.
//
//   DATABASE_URL=file:<copy-of-snapshot.db> npx tsx scripts/engine-slices.ts [--seasons 2023,2024,2025,2026] [--out docs/engine/slices] [--rows <file.json.gz>] [--live]
//
// Models replayed side by side on identical matches:
//   champion  the live engine (contextual model on the symmetric book)
//   v2.0      the frozen Engine 2.0 model on the same book (the live shadow)
//   legacy    Engine 1.x (sequential population update, Platt-calibrated Gaussian), the
//             program's historical baseline; reproduces 72.7% / Brier 0.179 on 2025–26.
// --live also slices the live ledger (predictions kind 'live' with a result), joined to the
// replay's data tags by match.
//
// Always run it on a COPY of a database: it runs migrations. It writes nothing else to it.
import "../server/env.js";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ENGINE_VERSION, FITTED_MODEL, RatingBook, explainMatch, predictMatch, type EventRecord, type MatchRecord } from "@control-scout/predict-engine";
import { all, kvGet, migrate } from "../server/db.js";
import { loadSeason, toEventRecord } from "../server/stats/load.js";
import { PREDICT_SEASONS, seasonInfo } from "../server/data/seasons.js";
import {
  EventOrdinals, densityBand, experienceOf, leastExperienced, marginBand, matchesBand, ordinalBand, probBand, qualBand, quantile, sizeBand, typeGroup, volatilityTag,
  type DataTags,
} from "./slices/tags.js";
import { calibrationMarkdown, sliceReport, sliceTable, type ScoredRow, type SliceReport } from "./slices/report.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const SEASONS = flag("--seasons")?.split(",").map(Number) ?? PREDICT_SEASONS;
const OUT = flag("--out") ?? join("docs", "engine", "slices");
const ROWS = flag("--rows");
const LIVE = args.includes("--live");
/** The champion's own out-of-sample season, which sets the priority order (fit + calibration used 2023–24). */
const PRIMARY = 2025;

await migrate();
const M = FITTED_MODEL;
if (!M.contextual?.fallback) throw new Error("this engine has no frozen 2.0 fallback to replay as v2.0");
const MODELS = ["champion", "v2.0", "legacy"] as const;
type Model = (typeof MODELS)[number];

interface Row { key: string; season: number; event: string; level: string; y: number; rated: boolean; data: DataTags; pred: Record<Model, { p: number; muR: number; muB: number; sdR: number; sdB: number }> }

const rookie = new Map((await all<{ number: number; rookie_year: number | null }>("SELECT number, rookie_year FROM teams")).map((r) => [Number(r.number), r.rookie_year == null ? null : Number(r.rookie_year)]));
const dataVersion = (await kvGet<string>("data:version")) ?? null;

const champion = new RatingBook(M.rating);
const legacy = new RatingBook({ ...M.rating, populationUpdate: "sequential" });
const ordinals = new EventOrdinals();
const rows: Row[] = [];
const corpus: Record<string, unknown>[] = [];
const outcome = (m: MatchRecord) => (m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5);
const keyOf = (season: number, code: string, level: string, series: number, number: number) => `${season}|${code}|${level}|${series}|${number}`;
let checked = 0;

for (const s of [...SEASONS].sort((a, b) => a - b)) {
  // The backtest's corpus, verbatim: scrimmages are predicted but never rated; only 2-robot alliances are predicted.
  const events = await loadSeason(s);
  const unrated = new Set(events.filter((e) => !toEventRecord(e)).map((e) => e.code));
  const recs = events.map((e) => toEventRecord(e, { anyType: true })).filter((x): x is EventRecord => !!x);
  const byCode = new Map(recs.map((e) => [e.code, e]));
  champion.startSeason(s); legacy.startSeason(s); ordinals.reset();
  const matches = recs.flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
  const hash = createHash("sha256");
  const first = rows.length;
  let surrogateMatches = 0;
  for (const m of matches) {
    hash.update(`${keyOf(s, m.eventCode, m.level, m.series, m.number)}|${m.time}|${m.red.teams.join(",")}|${m.blue.teams.join(",")}|${m.red.total}|${m.blue.total}\n`);
    if (m.red.surrogates?.length || m.blue.surrogates?.length) surrogateMatches++;
    if (m.red.teams.length === 2 && m.blue.teams.length === 2) {
      champion.setTime(m.time); legacy.setTime(m.time);
      const ev = byCode.get(m.eventCode)!;
      const teams = [...m.red.teams, ...m.blue.teams];
      const ctx = { level: m.level, event: m.eventCode };
      const pc = predictMatch(champion, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx, shadow: M.contextual.fallback });
      // The served number is explainMatch's: prove this replay matches it (every 250th match; it is the same call underneath).
      if (rows.length % 250 === 0) {
        const x = explainMatch(champion, m.red.teams, m.blue.teams, { noise: M.noise, calibration: M.calibration, contextual: M.contextual, context: ctx, shadow: M.contextual.fallback, band: M.band });
        if (x.winProbA !== pc.pRedWin || x.shadow?.winProbA !== pc.pShadow) throw new Error(`replay differs from explainMatch at ${m.eventCode} ${m.level} ${m.series}-${m.number}`);
        checked++;
      }
      const pl = predictMatch(legacy, m.red.teams, m.blue.teams, M.noise, M.calibration, {});
      const rated = teams.map((t) => champion.get(t).n);
      const vol = teams.filter((_, i) => rated[i] >= 6).map((t) => champion.reliabilityOf(t).variance);
      const side = (p: typeof pc, pr: number) => ({ p: pr, muR: p.red.mean, muB: p.blue.mean, sdR: p.red.sd, sdB: p.blue.sd });
      rows.push({
        key: keyOf(s, m.eventCode, m.level, m.series, m.number), season: s, event: m.eventCode, level: m.level, y: outcome(m), rated: !unrated.has(m.eventCode),
        data: {
          season: s, level: m.level, eventMatch: qualBand(m.level, m.number),
          teamEvent: ordinalBand(Math.min(...teams.map((t) => ordinals.ordinal(t, m.eventCode)))),
          experience: leastExperienced(teams.map((t) => experienceOf(rookie.get(t), s))),
          teamMatches: matchesBand(Math.min(...rated)), density: densityBand(rated.reduce((a, b) => a + b, 0)),
          volatilityScore: vol.length ? Math.max(...vol) : null,
          eventSize: sizeBand(ev.teams.length || new Set(ev.matches.flatMap((x) => [...x.red.teams, ...x.blue.teams])).size), eventType: typeGroup(ev.type),
        },
        pred: { champion: side(pc, pc.pRedWin), "v2.0": side(pc, pc.pShadow!), legacy: side(pl, pl.pRedWin) },
      });
    } else {
      for (const t of [...m.red.teams, ...m.blue.teams]) ordinals.ordinal(t, m.eventCode);
    }
    if (!unrated.has(m.eventCode)) { champion.update(m); legacy.update(m); }
  }
  const seasonRows = rows.slice(first);
  const cut = quantile(seasonRows.filter((r) => r.rated).map((r) => r.data.volatilityScore ?? NaN), 0.75);
  corpus.push({ season: s, label: seasonInfo(s).label, events: recs.length, unratedEvents: unrated.size, matches: matches.length, predicted: seasonRows.length, predictedRated: seasonRows.filter((r) => r.rated).length, surrogateMatches, volatilityCut: cut, sha256: hash.digest("hex") });
  for (const r of seasonRows) (r as Row & { vol?: string }).vol = volatilityTag(r.data.volatilityScore, cut);
  console.log(`${s}: ${matches.length} matches, ${seasonRows.length} predicted`);
}

const tagsOf = (r: Row, pr: Row["pred"][Model]): Record<string, string> => ({
  level: r.data.level, eventMatch: r.data.eventMatch, teamEvent: r.data.teamEvent, experience: r.data.experience,
  teamMatches: r.data.teamMatches, density: r.data.density, volatility: (r as Row & { vol: string }).vol,
  eventSize: r.data.eventSize, eventType: r.data.eventType,
  probBand: probBand(pr.p), margin: marginBand(pr.muR, pr.muB, pr.sdR, pr.sdB),
});
const DATA_DIMS = ["level", "eventMatch", "teamEvent", "experience", "teamMatches", "density", "volatility", "eventSize", "eventType"];
const LABELS: Record<string, string> = {
  level: "Match type", eventMatch: "Event phase: qualification match number", teamEvent: "Event phase: robot's event of the season (lowest on the field)",
  experience: "Team experience (least experienced robot)", teamMatches: "Rated matches this season (fewest on the field)", density: "Data density (all four robots' rated matches)",
  volatility: "Volatility (residual variance, robots with 6+ matches)", eventSize: "Event size (teams)", eventType: "Event type",
  probBand: "Favourite's stated chance", margin: "Expected margin (in SDs of the margin)",
};
const ORDER = [...DATA_DIMS, "probBand", "margin"];

const scored = (model: Model, keep: (r: Row) => boolean): ScoredRow[] => rows.filter(keep).map((r) => ({ p: r.pred[model].p, y: r.y, tags: tagsOf(r, r.pred[model]) }));
// Slices cover matches at rated events: the scope of the backtest ledger's published numbers (72.7% / 0.179
// for Engine 1.x on 2025–26). Scrimmage and off-season matches are predicted too, and reported on their own.
const blocks: [string, (r: Row) => boolean][] = SEASONS.map((s) => [String(s), (r) => r.season === s && r.rated]);
const unratedBlocks: [string, (r: Row) => boolean][] = SEASONS.map((s) => [String(s), (r) => r.season === s && !r.rated]);
const reports: Record<string, Record<string, SliceReport>> = {};
for (const model of MODELS) {
  reports[model] = {};
  for (const [name, keep] of blocks) reports[model][name] = sliceReport(scored(model, keep), DATA_DIMS);
}
const unratedReports: Record<string, Record<string, SliceReport["all"]>> = {};
for (const model of MODELS) {
  unratedReports[model] = {};
  for (const [name, keep] of unratedBlocks) unratedReports[model][name] = sliceReport(scored(model, keep), []).all;
}
/** The program's baseline check: Engine 1.x on 2025–26 must reproduce the published 72.7% / Brier 0.179 (to the rounding shown). */
const baselineCheck = (() => {
  const a = reports.legacy[String(PRIMARY)]?.all;
  if (!a?.n) return null;
  return { matches: a.n, accuracy: a.accuracy, brier: a.brier, published: { accuracy: 0.727, brier: 0.179 }, pass: Math.abs(a.accuracy - 0.727) <= 0.0005 && Math.abs(a.brier - 0.179) <= 0.0005 };
})();
const rowsSha = Object.fromEntries(MODELS.map((model) => [model, createHash("sha256").update(rows.map((r) => `${r.key}|${r.pred[model].p}`).join("\n")).digest("hex")]));

// ---- Live ledger (optional): the stated live probabilities, sliced by the replay's data tags.
let live: { engine: string; report: SliceReport }[] = [];
if (LIVE) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const lr = await all<any>("SELECT season, code, level, series, number, p_red, outcome, engine_version FROM predictions WHERE kind = 'live' AND outcome IS NOT NULL");
  const byEngine = new Map<string, ScoredRow[]>();
  for (const x of lr) {
    const r = byKey.get(keyOf(Number(x.season), x.code, x.level, Number(x.series), Number(x.number)));
    if (!r) continue;
    const p = Number(x.p_red);
    const list = byEngine.get(x.engine_version) ?? [];
    list.push({ p, y: Number(x.outcome), tags: tagsOf(r, { ...r.pred.champion, p }) });
    byEngine.set(x.engine_version, list);
  }
  live = [...byEngine].sort().map(([engine, xs]) => ({ engine, report: sliceReport(xs, DATA_DIMS) }));
  console.log(`live ledger: ${lr.length} scored calls, ${live.reduce((s, l) => s + l.report.all.n, 0)} matched to the corpus`);
}

// ---- Files.
const corpusId = `snapshot-${String(dataVersion ?? "unknown").slice(0, 10)}`;
const meta = {
  generated: new Date().toISOString().slice(0, 10), engine: ENGINE_VERSION, championModel: M.contextual.id, shadowModel: M.contextual.fallback.id,
  corpus: { id: corpusId, dataVersion, seasons: corpus, rules: "server/stats/job.ts backtest: remote/hybrid events dropped; scrimmage and off-season events predicted but never rated; only 2-robot alliances predicted; matches in start-time order, each predicted from earlier results only." },
  explainMatchChecks: checked, rowsSha256: rowsSha, baselineCheck, lowConfidenceBelow: 200, primarySeason: PRIMARY,
};
mkdirSync(OUT, { recursive: true });
const base = join(OUT, `engine-${ENGINE_VERSION}-${corpusId}`);
writeFileSync(`${base}.json`, JSON.stringify({ meta, reports, unrated: unratedReports, live }, null, 1) + "\n");
writeFileSync(`${base}.md`, markdown());
if (ROWS) writeFileSync(ROWS, gzipSync(JSON.stringify(rows)));
console.log(`wrote ${base}.json and .md`);

function markdown(): string {
  const f = (x: number, d = 2) => `${(100 * x).toFixed(d)}%`;
  const b = (x: number) => x.toFixed(4);
  const seasonsTable = ["| Season | Model | Matches | Accuracy | Brier | Log loss | ECE |", "|---|---|---|---|---|---|---|"];
  for (const [name] of blocks) for (const model of MODELS) {
    const a = reports[model][name].all;
    seasonsTable.push(`| ${seasonInfo(Number(name)).label}${Number(name) === PRIMARY ? " (reused)" : ""} | ${model} | ${a.n.toLocaleString("en-US")} | ${f(a.accuracy)} | ${b(a.brier)} | ${a.logLoss.toFixed(4)} | ${f(a.ece10)} |`);
  }
  const unratedTable = ["| Season | Model | Matches | Accuracy | Brier | Log loss |", "|---|---|---|---|---|---|"];
  for (const [name] of unratedBlocks) for (const model of MODELS) {
    const a = unratedReports[model][name];
    if (a.n) unratedTable.push(`| ${seasonInfo(Number(name)).label} | ${model} | ${a.n.toLocaleString("en-US")} | ${f(a.accuracy)} | ${b(a.brier)} | ${a.logLoss.toFixed(4)} |`);
  }
  const bc = baselineCheck;
  const P = reports.champion[String(PRIMARY)];
  const out = [
    `# Engine error report: ${ENGINE_VERSION} on ${corpusId}`,
    "",
    `Generated ${meta.generated} by \`scripts/engine-slices.ts\`. Engine ${ENGINE_VERSION} (champion model \`${meta.championModel}\`). Data version ${dataVersion ?? "unknown"}.`,
    "",
    "Every match is predicted from earlier results only, in the backtest ledger's order and with its exclusions. The replay is checked against the served prediction call (`explainMatch`) on " + checked + " matches. Slices with fewer than 200 matches are marked ⚠ low n and are never ranked.",
    "",
    "## Corpus",
    "",
    "| Season | Events | Unrated events | Matches | Predicted | Predicted at rated events | Surrogate matches | sha256 (match list) |",
    "|---|---|---|---|---|---|---|---|",
    ...corpus.map((c: any) => `| ${c.label} | ${c.events} | ${c.unratedEvents} | ${c.matches.toLocaleString("en-US")} | ${c.predicted.toLocaleString("en-US")} | ${c.predictedRated.toLocaleString("en-US")} | ${c.surrogateMatches} | \`${String(c.sha256).slice(0, 16)}…\` |`),
    "",
    "## Global numbers",
    "",
    "`champion` is the live engine; `v2.0` the frozen Engine 2.0 model on the same ratings (the live shadow); `legacy` Engine 1.x, the program's historical baseline (72.7%, Brier 0.179 on 2025–26). The champion's coefficients were fitted on 2023–24 and its calibration on spring 2025, so 2023–24 rows are in-sample for it. 2025–26 is its out-of-sample season, already examined for 2.0 and 2.1, hence **reused**: it sets priorities here and is not proof of any change.",
    "",
    ...seasonsTable,
    "",
    bc ? `**Baseline check:** legacy on 2025–26 scores ${f(bc.accuracy)} and Brier ${bc.brier.toFixed(4)} over ${bc.matches.toLocaleString("en-US")} matches, against the published 72.7% / 0.179: **${bc.pass ? "reproduced" : "NOT reproduced: the harness is wrong, not history"}**.` : "**Baseline check:** not run (2025–26 not in this replay).",
    "",
    "Matches at rated events only. Scrimmage and off-season events are predicted but never rated; their matches, on their own:",
    "",
    ...unratedTable,
    "",
    `## Where the champion loses most (${seasonInfo(PRIMARY).label})`,
    "",
    "Ranked by **excess Brier**: the Brier a slice carries above an average match, summed over its matches (Σ(Brier − corpus mean)). Only data slices compete, at most one per dimension: the dimensions overlap (thin data shows up as few matches, thin density and unmeasured volatility), and three views of one weakness would hide the next. Probability and margin bands are calibration diagnostics: a coin-flip band carries more Brier by construction.",
    "",
    "| # | Slice | Excess Brier | Share of Brier | Share of matches |",
    "|---|---|---|---|---|",
    ...P.top.map((t, i) => `| ${i + 1} | ${LABELS[t.dim]}: **${t.value}** | +${t.excessBrier.toFixed(1)} | ${f(t.shareBrier, 1)} | ${f(t.shareMatches, 1)} |`),
    "",
    "**Surprise** is the mean of (p − y)² − p(1 − p): the Brier above what the model's own probabilities expected. Above zero means the model is too sure in that slice; below zero means too timid. **Fav. stated → won** compares the favourite's mean stated chance with how often it won.",
    "",
    `### Calibration by stated chance (champion, ${seasonInfo(PRIMARY).label})`,
    "",
    calibrationMarkdown(P.calibration),
    "",
    `### All slices (champion, ${seasonInfo(PRIMARY).label})`,
    "",
    sliceTable(P.dims, ORDER, LABELS),
  ];
  for (const s of SEASONS.filter((x) => x !== PRIMARY)) {
    const R = reports.champion[String(s)];
    if (!R.all.n) continue;
    out.push(`## Champion, ${seasonInfo(s).label}${s < PRIMARY ? " (in-sample for the champion)" : " (season in progress)"}`, "", "Top excess-Brier slices: " + (R.top.map((t) => `${LABELS[t.dim]} **${t.value}** (+${t.excessBrier.toFixed(1)})`).join("; ") || "none"), "", calibrationMarkdown(R.calibration), "", sliceTable(R.dims, ORDER, LABELS));
  }
  out.push(`## Baselines on ${seasonInfo(PRIMARY).label}`, "");
  for (const model of ["v2.0", "legacy"] as const) {
    const R = reports[model][String(PRIMARY)];
    out.push(`### ${model}`, "", "Top excess-Brier slices: " + R.top.map((t) => `${LABELS[t.dim]} **${t.value}** (+${t.excessBrier.toFixed(1)})`).join("; "), "", calibrationMarkdown(R.calibration), "", sliceTable(R.dims, ORDER, LABELS));
  }
  out.push("## Live ledger", "");
  if (!LIVE) out.push("Not included in this run (`--live`).");
  else if (!live.length) out.push("No scored live calls in this database matched the corpus.");
  else for (const l of live) out.push(`### Engine ${l.engine} (live, ${l.report.all.n} calls)`, "", calibrationMarkdown(l.report.calibration), "", sliceTable(l.report.dims, ORDER, LABELS));
  out.push("", "## Definitions", "",
    "- **Ties** score 0.5 for Brier and log loss and are left out of accuracy (a 50% call counts half).",
    "- **Event phase**: the qualification match number at the event (playoffs separate), and the lowest season event ordinal among the four robots (any event with a predicted or played match counts, scrimmages included).",
    "- **Experience**: from FIRST's rookie year; rookie = this season, year 2 = last season. Unknown rookie years rank just above veteran.",
    "- **Rated matches / density**: the engine's own count of rated matches this season, before the match. Thin < 24 summed (under 6 per robot on average), dense ≥ 64 (16 or more).",
    "- **Volatility**: the highest residual-variance EMA (engine reliability state, 1 = as variable as the model assumes) among robots with 6+ rated matches. The cut is the season's 75th percentile; it labels matches and never feeds a prediction.",
    "- **Event size**: teams registered (or seen in matches). Small ≤ 16, mid 17–32, large 33+.",
    "- **Margin**: |expected red − expected blue| over √(sd_red² + sd_blue²). Close < 0.25, clear < 1, lopsided ≥ 1.",
    "- Playoff semifinal and final rounds are not split: the stored series numbers don't identify rounds consistently across seasons.",
    "");
  return out.join("\n");
}
