import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { SLICE_FACTS, SLICE_REPORT } from "./sliceFacts";
import { ENGINE_VERSIONS } from "./versions";

const root = join(__dirname, "..", "..", "..");

describe("How it works numbers trace to stored reports", () => {
  it("every quoted slice figure matches the stored slice report (to the rounding shown)", () => {
    const r = JSON.parse(readFileSync(join(root, "docs", "engine", "slices", `${SLICE_REPORT}.json`), "utf8"));
    const c = r.reports.champion["2025"], d = c.dims;
    const near = (a: number, b: number, tol = 0.0006) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
    near(SLICE_FACTS.accuracy, c.all.accuracy, 0.00006);
    near(SLICE_FACTS.thin.shareMatches, d.density.thin.shareMatches);
    near(SLICE_FACTS.thin.shareBrier, d.density.thin.shareBrier);
    near(SLICE_FACTS.thin.accuracy, d.density.thin.accuracy);
    near(SLICE_FACTS.dense.accuracy, d.density.dense.accuracy);
    near(SLICE_FACTS.firstTenQuals.shareMatches, d.eventMatch["q1-10"].shareMatches);
    near(SLICE_FACTS.firstTenQuals.shareBrier, d.eventMatch["q1-10"].shareBrier);
    near(SLICE_FACTS.firstTenQuals.accuracy, d.eventMatch["q1-10"].accuracy);
    near(SLICE_FACTS.lateQuals.accuracy, d.eventMatch["q26+"].accuracy);
  });

  it("the slice report is the running engine's, so the limits describe the engine people see", () => {
    expect(SLICE_REPORT.startsWith(`engine-${ENGINE_VERSION}-`)).toBe(true);
  });
});

describe("version history (doc-with-code rule)", () => {
  it("opens with the running engine and lists every release in the engine's changelog, newest first", () => {
    expect(ENGINE_VERSIONS[0].version).toBe(ENGINE_VERSION);
    const log = readFileSync(join(root, "packages", "predict-engine", "CHANGELOG.md"), "utf8");
    const released = [...log.matchAll(/^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})/gm)].map((m) => ({ version: m[1], date: m[2] }));
    expect(ENGINE_VERSIONS.map(({ version, date }) => ({ version, date }))).toEqual(released);
    for (const v of ENGINE_VERSIONS) expect(v.line.length).toBeLessThanOrEqual(160);
  });
});
