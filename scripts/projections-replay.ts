// Replay finished events cut at their midpoint: how often does a team's actual final quals rank land
// inside the projection's P10–P90 band? No hindsight: ratings frozen at the event's start (plus the
// first half's results, folded in exactly as a live projection folds them), the second half's
// results, every rank and the alliances stripped.
//
//   npm run projections:replay -- [season] [--events N] [--runs N] [--fixture CODE,CODE,…]
//
// --fixture writes server/projections/__fixtures__/midpoint.json (the simulation inputs and actual
// ranks of those events) for replay.test.ts.
import "../server/env.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ADVANCING_TYPES, normType, type EventInput } from "@control-scout/predict-engine";
import { all, migrate } from "../server/db.js";
import { forecasterFor } from "../server/predict/engine.js";
import { eventDetail, toEventInput } from "../server/api/events.js";
import { projectionInput } from "../server/projections/input.js";
import { simulateProjection, textSeed } from "../server/projections/core.js";
import { serializeInput, type FixtureEvent } from "../server/projections/fixture.js";

await migrate();
const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? 2025);
const maxEvents = Number(flag("--events") ?? 40);
const runs = Number(flag("--runs") ?? 2000);
const fixtureCodes = flag("--fixture")?.split(",").map((c) => c.toUpperCase()) ?? [];

/** The event cut at its midpoint: first half of quals played, the rest unplayed; no ranks, alliances or playoffs. */
function midpoint(ev: EventInput): EventInput {
  const quals = ev.matches.filter((m) => m.level === "qual").sort((a, b) => a.number - b.number);
  const half = Math.floor(quals.length / 2);
  return {
    ...ev,
    field: ev.field.map((f) => ({ ...f, rank: null })),
    alliances: [],
    matches: quals.map((m, i) => (i < half ? m : { ...m, played: false, red: { ...m.red, score: null }, blue: { ...m.blue, score: null } })),
  };
}

const f = await forecasterFor(season);
const rows = await all<any>(
  `SELECT e.code, e.type, (SELECT COUNT(*) FROM matches m WHERE m.season = e.season AND m.code = e.code AND m.level = 'qual' AND m.played = 1) q,
     (SELECT COUNT(*) FROM event_teams t WHERE t.season = e.season AND t.code = e.code AND t.rank IS NOT NULL) ranked
   FROM events e WHERE e.season = ? ORDER BY e.start, e.code`, [season]);
const pool = rows.filter((r) => ADVANCING_TYPES.has(normType(r.type)) && Number(r.q) >= 20 && Number(r.ranked) >= 16);
const pick = fixtureCodes.length ? pool.filter((r) => fixtureCodes.includes(r.code)) : pool.filter((_, i) => i % Math.max(1, Math.floor(pool.length / maxEvents)) === 0).slice(0, maxEvents);

let inside = 0, total = 0, ms = 0;
const fixture: FixtureEvent[] = [];
for (const r of pick) {
  const d = await eventDetail(season, r.code);
  if (!d) continue;
  const full = toEventInput(d.event, d.field, d.matches, d.alliances);
  const view = f.preEventView(full);
  if (!view) continue;
  // The frozen forecaster with the event's first half played (results folded into its ratings like a live projection's).
  const cut = midpoint(full);
  const pi = projectionInput(view.f, cut);
  if (!pi) continue;
  const seed = textSeed(`${season}|${r.code}|replay`);
  const res = await simulateProjection(pi.input, { runs, floor: runs, budgetMs: Infinity, seed });
  ms += res.computeMs;
  const actual = new Map(d.field.filter((x) => x.rank != null).map((x) => [x.team, x.rank!]));
  let hit = 0, n = 0;
  for (const t of res.teams) {
    const a = actual.get(t.team);
    if (a == null || !t.rank) continue;
    n++; if (a >= t.rank.p10 && a <= t.rank.p90) hit++;
  }
  inside += hit; total += n;
  console.log(`${r.code.padEnd(10)} ${String(n).padStart(3)} teams  ${hit}/${n} inside P10–P90 (${Math.round((hit / Math.max(1, n)) * 100)}%)  ${Math.round(res.computeMs)} ms for ${res.runs} sims`);
  if (fixtureCodes.includes(r.code)) fixture.push({ code: r.code, input: serializeInput(pi.input), actual: [...actual.entries()] });
}
console.log(`\n${season}: ${inside}/${total} team finishes inside their midpoint P10–P90 band (${((inside / Math.max(1, total)) * 100).toFixed(1)}%) over ${pick.length} events; ${(ms / Math.max(1, pick.length)).toFixed(0)} ms per event for ${runs} sims`);
if (fixture.length) {
  const dir = join(process.cwd(), "server", "projections", "__fixtures__");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "midpoint.json"), JSON.stringify({ season, built: new Date().toISOString().slice(0, 10), events: fixture }) + "\n");
  console.log(`wrote ${fixture.length} events to server/projections/__fixtures__/midpoint.json`);
}
process.exit(0);
