// Engine program Part 9: fit the shipped per-slice calibration (engine 2.8) on the latest
// two years of replayed calls of the current engine, and store the fit as an artifact.
// The settings (cells level × data density, 730-day window, ridge 200) were chosen with
// scripts/part9/recalibration.ts on rolling origins; this only refits them on the newest data.
//
//   npx tsx scripts/part9/fit-recalibration.ts <rows.json.gz from engine-slices --rows> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fitSliceCalibration, logit } from "./lib.js";

const [rowsPath, outPath] = process.argv.slice(2);
const WINDOW_DAYS = 730, RIDGE = 200;
const buf = gunzipSync(readFileSync(rowsPath));
const rows = (JSON.parse(buf.toString()) as { rated: boolean; time: number; y: number; data: Record<string, string>; pred: { champion: { p: number } } }[]).filter((r) => r.rated);
const end = Math.max(...rows.map((r) => r.time)), start = end - WINDOW_DAYS * 864e5;
const train = rows.filter((r) => r.time > start);
const f = fitSliceCalibration(train.map((r) => logit(r.pred.champion.p)), train.map((r) => r.y), train.map((r) => `${r.data.level}|${r.data.density}`), RIDGE);
const round = (x: number) => Math.round(x * 1e6) / 1e6;
const out = {
  densityCuts: [24, 64],
  global: { slope: round(f.global[0]), intercept: round(f.global[1]) },
  cells: Object.fromEntries(Object.entries(f.cells).map(([c, m]) => [c, { slope: round(m.slope), intercept: round(m.intercept), n: m.n }])),
  provenance: {
    fittedOn: `rated matches ${new Date(start).toISOString().slice(0, 10)} to ${new Date(end).toISOString().slice(0, 10)} (${train.length})`,
    windowDays: WINDOW_DAYS, ridge: RIDGE, cells: "level × data density (all four robots' rated matches: thin < 24, dense ≥ 64)",
    rowsSha256: createHash("sha256").update(buf).digest("hex"),
  },
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
