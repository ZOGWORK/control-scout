// Engine equivalence check: replays real seasons through Control Point's
// in-repo engine (server/predict/*) and through @control-scout/predict-engine,
// and requires bit-identical ratings, match predictions and event forecasts.
// This is the gate for swapping Control Point onto the shared package with
// "zero visible change".
//
//   npx tsx scripts/engine-equivalence.ts [path-to-control-point] [seasons…]
//
// Reads Control Point's raw FTC Scout cache (.cache/predict/scout/<season>);
// never writes to that repo.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as pkg from "@control-scout/predict-engine";

const CP = process.argv[2] ?? "C:/Users/mksus/StudioProjects/control-point";
const SEASONS = (process.argv.slice(3).map(Number).filter(Boolean).length ? process.argv.slice(3).map(Number) : [2023, 2024, 2025]);

const imp = (rel: string) => import(pathToFileURL(join(CP, rel)).href);
const cpRating = await imp("server/predict/rating.ts");
const cpMatch = await imp("server/predict/matchModel.ts");
const cpScout = await imp("server/predict/scoutData.ts");
const cpSim = await imp("server/predict/sim.ts");
const cpModel = JSON.parse(readFileSync(join(CP, "server/predict/model.json"), "utf8"));

let failures = 0;
const fail = (msg: string) => { failures++; if (failures <= 20) console.error("MISMATCH", msg); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

if (!same(cpModel, pkg.FITTED_MODEL)) fail("model.json differs from FITTED_MODEL");

function load(season: number, parse: (r: unknown, s: number) => any) {
  const dir = join(CP, ".cache", "predict", "scout", String(season));
  if (!existsSync(dir)) return [];
  const out: any[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    const ev = parse(JSON.parse(readFileSync(join(dir, f), "utf8")), season);
    if (ev) out.push(ev);
  }
  return out.sort((a, b) => a.startTime - b.startTime || a.code.localeCompare(b.code));
}

const cpBook = new cpRating.RatingBook(cpModel.rating);
const pkBook = new pkg.RatingBook(pkg.FITTED_MODEL.rating);
let matches = 0, predictions = 0;
for (const season of SEASONS) {
  const evA = load(season, cpScout.parseScoutEventRecord);
  if (!evA.length) { console.error(`No cached events for ${season} under ${CP}/.cache/predict/scout — nothing to compare.`); process.exit(1); }
  const evB = load(season, pkg.parseScoutEventRecord);
  // Map → JSON loses entries; compare ranks separately.
  if (!same(evA.map((e) => ({ ...e, ranks: [...e.ranks] })), evB.map((e) => ({ ...e, ranks: [...e.ranks] })))) fail(`${season}: parsed events differ`);
  cpBook.startSeason(season);
  pkBook.startSeason(season);
  const ms = evA.flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
  for (const m of ms) {
    // Predict before folding in: the live-forecast path.
    if (m.red.teams.length === 2 && m.blue.teams.length === 2 && matches % 7 === 0) {
      const a = cpMatch.predictMatch(cpBook, m.red.teams, m.blue.teams, cpModel.noise, cpModel.calibration);
      const b = pkg.predictMatch(pkBook as any, m.red.teams, m.blue.teams, pkg.FITTED_MODEL.noise, pkg.FITTED_MODEL.calibration);
      if (!same(a, b)) fail(`${season} ${m.eventCode} ${m.level}${m.number}: predictMatch ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      predictions++;
    }
    cpBook.update(m);
    pkBook.update(m);
    matches++;
  }
  if (!same(cpBook.toData(), pkBook.toData())) fail(`${season}: rating books differ after replay`);

  // Whole-event simulation on a few real events (same seed → same draws).
  for (const ev of evA.filter((e) => e.matches.some((m: any) => m.level === "qual")).slice(-3)) {
    const quals = ev.matches.filter((m: any) => m.level === "qual").map((m: any) => ({ red: m.red.teams, blue: m.blue.teams }));
    const ratings = new Map(ev.teams.map((t: number) => [t, cpBook.get(t)]));
    const input = { season, ratings, quals, noise: cpModel.noise, bonus: cpModel.bonus[String(season)], pick: cpModel.pick, awards: { mode: "none" }, prequalified: new Set<number>(), slots: 4, runs: 300, seed: 7 };
    const a = [...cpSim.simulateEvent(input as any).values()];
    const b = [...pkg.simulateEvent(input as any).values()];
    if (!same(a, b)) fail(`${season} ${ev.code}: simulateEvent differs`);
  }
  console.log(`${season}: ${evA.length} events, ratings identical so far: ${failures === 0}`);
}

console.log(`\nReplayed ${matches} matches, compared ${predictions} pre-match predictions.`);
if (!matches || !predictions) { console.error("Replayed no matches — NOT a valid equivalence check."); process.exit(1); }
if (failures) { console.error(`${failures} mismatch(es) — NOT equivalent.`); process.exit(1); }
console.log("EQUIVALENT: package output is bit-identical to Control Point's engine.");
