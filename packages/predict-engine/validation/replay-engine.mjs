// Replays the research cohort (events.json.gz from the validation package's
// export_data.py) through a BUILT @control-scout/predict-engine dist, with the
// research protocol: inside each timestamp group every match is predicted
// before any of the group's results is learned.
//
// usage: node replay-engine.mjs <engine dist dir> <events.json.gz> <out dir> [config ...]
// configs: legacy_seq | primary_seq | pop_only | combined
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";

const [distDir, eventsPath, outDir, ...names] = process.argv.slice(2);
const E = await import(pathToFileURL(resolve(distDir, "index.js")).href);
const events = JSON.parse(gunzipSync(readFileSync(eventsPath)));
mkdirSync(outDir, { recursive: true });
const M = E.FITTED_MODEL;
const CONFIGS = {
  legacy_seq: { populationUpdate: "sequential", contextual: false },
  primary_seq: { populationUpdate: "sequential", contextual: true },
  pop_only: { populationUpdate: "symmetric", contextual: false },
  combined: { populationUpdate: "symmetric", contextual: true },
};
for (const name of names.length ? names : Object.keys(CONFIGS)) {
  const c = CONFIGS[name];
  const t0 = Date.now();
  const book = new E.RatingBook({ ...M.rating, populationUpdate: c.populationUpdate });
  const rows = [];
  for (const season of [2023, 2024, 2025, 2026]) {
    book.startSeason(season);
    const evs = events.filter((e) => e.season === season);
    const byCode = new Map(evs.map((e) => [e.code, e]));
    const timeline = evs.flatMap((e) => e.matches).sort((a, b) => a.time - b.time || a.eventCode.localeCompare(b.eventCode) || (a.level === "qual" ? 0 : 1) - (b.level === "qual" ? 0 : 1) || a.series - b.series || a.number - b.number);
    for (let i = 0; i < timeline.length;) {
      const at = timeline[i].time; let j = i + 1;
      while (j < timeline.length && timeline[j].time === at) j++;
      book.setTime(at);
      if (season >= 2025) for (let k = i; k < j; k++) {
        const m = timeline[k], ev = byCode.get(m.eventCode);
        const p = E.predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, c.contextual ? { context: { level: m.level }, contextual: M.contextual } : {});
        const all = [...m.red.teams, ...m.blue.teams].map((t) => book.get(t));
        rows.push({
          id: `${season}|${m.eventCode}|${m.level}|${m.series}|${m.number}`, season, event: m.eventCode, region: ev.region, time: m.time, level: m.level,
          y: m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5, nMin: Math.min(...all.map((x) => x.n)),
          p: p.pRedWin, model: p.model, muR: p.red.mean, muB: p.blue.mean, sdR: p.red.sd, sdB: p.blue.sd, actR: m.red.total, actB: m.blue.total, dq: m.red.dq || m.blue.dq,
        });
      }
      for (let k = i; k < j; k++) book.update(timeline[k]);
      i = j;
    }
  }
  writeFileSync(join(outDir, `${name}.json.gz`), gzipSync(JSON.stringify(rows)));
  console.log(JSON.stringify({ name, rows: rows.length, contextual: rows.filter((r) => r.model === "contextual").length, seconds: (Date.now() - t0) / 1000 }));
}
