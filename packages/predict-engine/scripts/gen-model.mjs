// Regenerates src/model.ts from src/model.json (the fitted model).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const json = readFileSync(join(src, "model.json"), "utf8").trim();
const header = `// Predict — the fitted model (rating settings, score noise, pick, bonus-RP,
// award and calibration parameters) plus its back-test accuracy.
//
// Generated from model.json (fitted by Control Point's scripts/predict
// research pipeline: tuned on 2024–25, tested on 2025–26). Kept as a module so
// it bundles into the browser with no JSON loader. Edit model.json and run
// scripts/gen-model.mjs; a test checks the two never drift.
import type { PredictModel } from "./forecast.js";

// Same as Control Point's runtime JSON.parse cast: \`rating\` holds only the
// tuned fields; RatingBook fills the rest from DEFAULT_RATING_PARAMS.
export const FITTED_MODEL = `;
writeFileSync(join(src, "model.ts"), `${header}${json} as unknown as PredictModel;\n`);
console.log("model.ts regenerated");
