// Engine program Part 9: fit the shipped recalibration (engine 2.8) on the latest two years of
// replayed calls of the current engine, and store the fit as an artifact. One slope, no intercept:
// P(red) = sigmoid(slope · logit(p)). The form and window were chosen on rolling origins
// (scripts/part9/recalibration.ts, slope-check.ts); this only refits the slope on the newest data.
//
//   npx tsx scripts/part9/fit-recalibration.ts <rows.json.gz from engine-slices --rows> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fit, logit } from "./lib.js";

const [rowsPath, outPath] = process.argv.slice(2);
const WINDOW_DAYS = 730;
const buf = gunzipSync(readFileSync(rowsPath));
const rows = (JSON.parse(buf.toString()) as { rated: boolean; time: number; y: number; pred: { champion: { p: number } } }[]).filter((r) => r.rated);
const end = Math.max(...rows.map((r) => r.time)), start = end - WINDOW_DAYS * 864e5;
const train = rows.filter((r) => r.time > start);
// The intercept is pinned at 0 (an enormous penalty): no alliance-colour term.
const [slope] = fit(train.map((r) => [logit(r.pred.champion.p), 1]), train.map((r) => r.y), [1e-4, 1e12], [1, 0]);
const out = {
  slope: Math.round(slope * 1e6) / 1e6,
  provenance: {
    fittedOn: `rated matches ${new Date(start).toISOString().slice(0, 10)} to ${new Date(end).toISOString().slice(0, 10)}`,
    matches: train.length, windowDays: WINDOW_DAYS, form: "sigmoid(slope · logit(p)), no intercept",
    rowsSha256: createHash("sha256").update(buf).digest("hex"),
  },
};
writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n");
console.log(JSON.stringify(out, null, 1));
