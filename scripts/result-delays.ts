// How long after a match starts does FIRST publish its result? Input for scripts/sync-lag.ts.
// GET /{season}/matches/{code} for a sample of events: postResultTime − actualStartTime.
import { firstGet } from "../server/sources/first.js";
import { all } from "../server/db.js";
import { writeFileSync } from "node:fs";
const season = Number(process.argv[2] ?? 2025);
const n = Number(process.argv[3] ?? 20);
const evs = await all<{ code: string }>(
  `SELECT e.code FROM events e WHERE e.season = ? AND e.type IN ('Qualifier','LeagueTournament','Championship','Regional') AND e.remote = 0
   AND (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.played = 1) >= 30 ORDER BY random() LIMIT ?`, [season, n]);
const out: { code: string; level: string; series: number; number: number; start: string; post: string; delayS: number }[] = [];
for (const { code } of evs) {
  const d = await firstGet<any>(`/${season}/matches/${code}`);
  for (const m of d?.matches ?? []) {
    if (!m.actualStartTime || !m.postResultTime) continue;
    const s = Date.parse(`${m.actualStartTime}Z`), p = Date.parse(`${m.postResultTime}Z`);
    if (!Number.isFinite(s) || !Number.isFinite(p)) continue;
    out.push({ code, level: String(m.tournamentLevel), series: m.series ?? 0, number: m.matchNumber, start: m.actualStartTime, post: m.postResultTime, delayS: (p - s) / 1000 });
  }
}
writeFileSync(process.argv[4] ?? "delays.json", JSON.stringify(out));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };
const ds = out.map((x) => x.delayS);
console.log(`events ${evs.length}, matches ${out.length}; delay s: p10 ${q(ds, 0.1)} p50 ${q(ds, 0.5)} p90 ${q(ds, 0.9)} p99 ${q(ds, 0.99)}`);
