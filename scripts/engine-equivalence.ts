// Engine equivalence check: Control Point must run exactly the engine this
// workspace builds. Two gates:
//   1. bytes — every file of Control Point's vendored tarball
//      (vendor/control-scout-predict-engine-<v>.tgz) equals this workspace's
//      packages/predict-engine build (dist/, package.json);
//   2. numbers — real seasons replayed through Control Point's installed
//      engine (its server/predict/* re-exports) and through this workspace's
//      package give identical ratings and reliability state, identical
//      match predictions (legacy and contextual, qual and playoff) and
//      identical event simulations.
//
//   npx tsx scripts/engine-equivalence.ts [path-to-control-point] [seasons…]
//
// Reads Control Point's raw FTC Scout cache (CP_CACHE, else .cache/ or .data/predict/scout/<season>);
// never writes to that repo. Run `npm run build -w @control-scout/predict-engine`
// first, and `npm install` in Control Point after vendoring.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as pkg from "@control-scout/predict-engine";

const CP = process.argv[2] ?? "C:/Users/mksus/StudioProjects/control-point";
const SEASONS = (process.argv.slice(3).map(Number).filter(Boolean).length ? process.argv.slice(3).map(Number) : [2023, 2024, 2025]);
const ENGINE_DIR = join(import.meta.dirname, "..", "packages", "predict-engine");

let failures = 0;
const fail = (msg: string) => { failures++; if (failures <= 20) console.error("MISMATCH", msg); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// 1. Bytes: the vendored tarball vs this workspace's build.
// ---------------------------------------------------------------------------
/** Files of a .tgz (ustar), keyed by path without the leading "package/". */
function untar(tgz: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(tgz);
  const out = new Map<string, Buffer>();
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a: number, n: number) => h.subarray(a, a + n).toString("utf8").replace(/\0.*$/s, "");
    const name = (str(345, 155) ? `${str(345, 155)}/` : "") + str(0, 100);
    const size = parseInt(str(124, 12).trim() || "0", 8);
    const type = str(156, 1);
    if (type === "0" || type === "") out.set(name.replace(/^package\//, ""), Buffer.from(tar.subarray(off + 512, off + 512 + size)));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
const vendorDir = join(CP, "vendor");
const tgzName = existsSync(vendorDir) ? readdirSync(vendorDir).find((f) => /^control-scout-predict-engine-.*\.tgz$/.test(f)) : undefined;
if (!tgzName) { console.error(`No vendored engine tarball under ${vendorDir}.`); process.exit(1); }
const vendored = untar(readFileSync(join(vendorDir, tgzName)));
let files = 0;
for (const [name, bytes] of vendored) {
  if (!name.startsWith("dist/") && name !== "package.json") continue;
  const local = join(ENGINE_DIR, name);
  if (!existsSync(local)) { fail(`${name}: in ${tgzName} but not in this build`); continue; }
  if (!readFileSync(local).equals(bytes)) fail(`${name}: bytes differ from ${tgzName}`);
  files++;
}
for (const f of readdirSync(join(ENGINE_DIR, "dist"))) if (!vendored.has(`dist/${f}`)) fail(`dist/${f}: built here but missing from ${tgzName}`);
const vendoredVersion = JSON.parse(vendored.get("package.json")!.toString("utf8")).version;
if (vendoredVersion !== pkg.ENGINE_VERSION) fail(`version: vendored ${vendoredVersion}, workspace ${pkg.ENGINE_VERSION}`);
console.log(`bytes: ${files} files of ${tgzName} compared with this build`);

// ---------------------------------------------------------------------------
// 2. Numbers: Control Point's installed engine vs this workspace's package.
// ---------------------------------------------------------------------------
const imp = (rel: string) => import(pathToFileURL(join(CP, rel)).href);
const cpRating = await imp("server/predict/rating.ts");
const cpMatch = await imp("server/predict/matchModel.ts");
const cpScout = await imp("server/predict/scoutData.ts");
const cpSim = await imp("server/predict/sim.ts");
const cpModel = JSON.parse(readFileSync(join(CP, "node_modules", "@control-scout", "predict-engine", "dist", "model.json"), "utf8"));
const cpVersion = JSON.parse(readFileSync(join(CP, "node_modules", "@control-scout", "predict-engine", "package.json"), "utf8")).version;
if (cpVersion !== pkg.ENGINE_VERSION) fail(`installed in Control Point: ${cpVersion}, workspace ${pkg.ENGINE_VERSION} (run npm install there)`);
if (!same(cpModel, pkg.FITTED_MODEL)) fail("Control Point's model.json differs from FITTED_MODEL");

/** Control Point's raw FTC Scout cache: CP_CACHE when set (e.g. the main checkout's, for a release
 *  worktree that has none), else .cache/predict/scout, else .data/predict/scout (where it lives now). */
const CACHE = process.env.CP_CACHE ?? [join(CP, ".cache", "predict", "scout"), join(CP, ".data", "predict", "scout")].find((d) => existsSync(d)) ?? join(CP, ".cache", "predict", "scout");

function load(season: number, parse: (r: unknown, s: number) => any) {
  const dir = join(CACHE, String(season));
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
  if (!evA.length) { console.error(`No cached events for ${season} under ${CACHE} — nothing to compare.`); process.exit(1); }
  const evB = load(season, pkg.parseScoutEventRecord);
  // Map → JSON loses entries; compare ranks separately.
  if (!same(evA.map((e) => ({ ...e, ranks: [...e.ranks] })), evB.map((e) => ({ ...e, ranks: [...e.ranks] })))) fail(`${season}: parsed events differ`);
  cpBook.startSeason(season);
  pkBook.startSeason(season);
  const ms = evA.flatMap((e) => e.matches).sort((x, y) => x.time - y.time);
  for (const m of ms) {
    // Predict before folding in: the live-forecast path, both probability models and levels.
    if (m.red.teams.length && m.blue.teams.length && matches % 7 === 0) {
      for (const o of [{}, { contextual: cpModel.contextual, context: { level: "qual" } }, { contextual: cpModel.contextual, context: { level: "playoff" } }]) {
        const a = cpMatch.predictMatch(cpBook, m.red.teams, m.blue.teams, cpModel.noise, cpModel.calibration, o);
        const b = pkg.predictMatch(pkBook as any, m.red.teams, m.blue.teams, pkg.FITTED_MODEL.noise, pkg.FITTED_MODEL.calibration, o as pkg.PredictOptions);
        if (!same(a, b)) fail(`${season} ${m.eventCode} ${m.level}${m.number}: predictMatch ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
        predictions++;
      }
    }
    cpBook.update(m);
    pkBook.update(m);
    matches++;
  }
  if (!same(cpBook.toData(), pkBook.toData())) fail(`${season}: rating books (incl. reliability state) differ after replay`);

  // Whole-event simulation on a few real events (same seed → same draws).
  for (const ev of evA.filter((e) => e.matches.some((m: any) => m.level === "qual")).slice(-3)) {
    const quals = ev.matches.filter((m: any) => m.level === "qual").map((m: any) => ({ red: m.red.teams, blue: m.blue.teams }));
    const ratings = new Map(ev.teams.map((t: number) => [t, cpBook.get(t)]));
    const input = { season, ratings, quals, noise: cpModel.noise, bonus: cpModel.bonus[String(season)], pick: cpModel.pick, awards: { mode: "none" }, prequalified: new Set<number>(), slots: 4, runs: 300, seed: 7 };
    const a = [...cpSim.simulateEvent(input as any).values()];
    const b = [...pkg.simulateEvent(input as any).values()];
    if (!same(a, b)) fail(`${season} ${ev.code}: simulateEvent differs`);
  }
  console.log(`${season}: ${evA.length} events, identical so far: ${failures === 0}`);
}

console.log(`\nReplayed ${matches} matches, compared ${predictions} pre-match predictions.`);
if (!matches || !predictions) { console.error("Replayed no matches — NOT a valid equivalence check."); process.exit(1); }
if (failures) { console.error(`${failures} mismatch(es) — NOT equivalent.`); process.exit(1); }
console.log(`EQUIVALENT: Control Point runs byte-identical engine ${pkg.ENGINE_VERSION}, with bit-identical outputs.`);
