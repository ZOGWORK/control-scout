// Experiment replay: Engine 2.0 (built dist) over 2023–2025 with the research
// protocol (all predictions of a timestamp group before any of its results),
// emitting per-match rows with 2.0's probability, its 17 inputs, score
// predictions, and candidate features for the second-round tracks. Every
// candidate state is learned only from results before the prediction.
//
// usage: node exp-replay.mjs <dist dir> <events.json.gz> <out.json.gz> [populationUpdate=symmetric] [ratingOverridesJSON]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [distDir, eventsPath, out, pop = "symmetric", overrides = "{}"] = process.argv.slice(2);
const E = await import(pathToFileURL(resolve(distDir, "index.js")).href);
const events = JSON.parse(gunzipSync(readFileSync(eventsPath)));
const M = E.FITTED_MODEL;
const book = new E.RatingBook({ ...M.rating, populationUpdate: pop, ...JSON.parse(overrides) });
const DAY = 864e5;
const np = (r) => r.auto + r.teleop + r.endgame;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Candidate per-team states (reset each season, like the reliability state).
let fast, evForm, lastFail, sinceFail, defense, pairs, lastNp;
const reset = () => { fast = new Map(); evForm = new Map(); lastFail = new Map(); sinceFail = new Map(); defense = new Map(); pairs = new Map(); lastNp = new Map(); };
const pairKey = (ts) => [...ts].sort((a, b) => a - b).join("-");

const rows = [];
for (const season of [2023, 2024, 2025]) {
  book.startSeason(season); reset();
  const evs = events.filter((e) => e.season === season);
  const byCode = new Map(evs.map((e) => [e.code, e]));
  const tl = evs.flatMap((e) => e.matches).sort((a, b) => a.time - b.time || a.eventCode.localeCompare(b.eventCode) || (a.level === "qual" ? 0 : 1) - (b.level === "qual" ? 0 : 1) || a.series - b.series || a.number - b.number);
  for (let i = 0; i < tl.length;) {
    const at = tl[i].time; let j = i + 1;
    while (j < tl.length && tl[j].time === at) j++;
    book.setTime(at);
    for (let k = i; k < j; k++) {
      const m = tl[k], ev = byCode.get(m.eventCode);
      const red = m.red.teams, blue = m.blue.teams;
      const p = E.predictMatch(book, red, blue, M.noise, M.calibration, { context: { level: m.level }, contextual: M.contextual });
      const x = E.contextualFeatures(book, red, blue, { ...p, pRedWin: p.pRaw }, { level: m.level });
      const rr = red.map((t) => book.get(t)), br = blue.map((t) => book.get(t));
      const all = [...rr, ...br];
      const S = Math.sqrt(p.red.sd ** 2 + p.blue.sd ** 2);
      const days = (r) => Math.max(0, Math.min(120, (book.now - (r.asOf ?? book.now)) / DAY));
      const side = (ts, f) => mean(ts.map(f));
      const evf = (t) => { const s = evForm.get(t); return s && s.code === m.eventCode ? s.sum / (s.n + 2) : 0; };
      const evn = (t) => { const s = evForm.get(t); return s && s.code === m.eventCode ? s.n : 0; };
      const rel = (t) => book.reliabilityOf(t);
      const minOf = (rs, c) => Math.min(...rs.map((r) => r[c]));
      const share = (r) => (np(r) > 1 ? r.auto / np(r) : 0);
      const comp = (rs) => (rs.length > 1 ? Math.abs(share(rs[0]) - share(rs[1])) : 0);
      const prod = (rs, c) => (rs.length > 1 ? rs[0][c] * rs[1][c] : 0);
      const fam = (ts) => Math.log1p(pairs.get(pairKey(ts)) ?? 0);
      rows.push({
        id: `${season}|${m.eventCode}|${m.level}|${m.series}|${m.number}`, season, event: m.eventCode, eventType: ev.type, region: ev.region, time: m.time, level: m.level,
        y: m.red.total > m.blue.total ? 1 : m.red.total < m.blue.total ? 0 : 0.5,
        nMin: Math.min(...all.map((r) => r.n)), maxGap: Math.max(...all.map(days)), unknown: all.filter((r) => !r.n).length,
        p: p.pRedWin, pRaw: p.pRaw, muR: p.red.mean, muB: p.blue.mean, sdR: p.red.sd, sdB: p.blue.sd, actR: m.red.total, actB: m.blue.total, npR: m.red.np, npB: m.blue.np,
        x,
        c: {
          // Track A: changing robot performance
          evForm: side(red, evf) - side(blue, evf),
          evN: Math.log1p(Math.min(...[...red, ...blue].map(evn))),
          momentum: side(red, (t) => (fast.get(t) ?? 0) - rel(t).bias) - side(blue, (t) => (fast.get(t) ?? 0) - rel(t).bias),
          lastFail: side(red, (t) => lastFail.get(t) ?? 0) - side(blue, (t) => lastFail.get(t) ?? 0),
          recovery: side(red, (t) => Math.log1p(Math.min(10, sinceFail.get(t) ?? 10))) - side(blue, (t) => Math.log1p(Math.min(10, sinceFail.get(t) ?? 10))),
          longGap: (rr.filter((r) => r.n && days(r) > 28).length - br.filter((r) => r.n && days(r) > 28).length) / 2,
          lastNp: (side(red, (t) => lastNp.get(t) ?? 0) - side(blue, (t) => lastNp.get(t) ?? 0)) / S,
          // Track B: alliance interactions
          autoMin: (minOf(rr, "auto") - minOf(br, "auto")) / S,
          egMin: (minOf(rr, "endgame") - minOf(br, "endgame")) / S,
          roleComp: comp(rr) - comp(br),
          congestion: (prod(rr, "teleop") - prod(br, "teleop")) / (S * S),
          defense: side(red, (t) => defense.get(t) ?? 0) - side(blue, (t) => defense.get(t) ?? 0),
          familiarity: fam(red) - fam(blue),
        },
      });
    }
    // Learn the group's results (after every prediction of the group).
    for (let k = i; k < j; k++) {
      const m = tl[k];
      const exp = { red: book.allianceExpectation(m.red.teams), blue: book.allianceExpectation(m.blue.teams) };
      const z = {}, failed = {};
      for (const s of ["red", "blue"]) { const r = E.allianceResidual(exp[s], m[s].np); z[s] = r.z; failed[s] = r.failed; }
      for (const [s, o] of [["red", "blue"], ["blue", "red"]]) {
        for (const t of m[s].teams) {
          fast.set(t, 0.5 * (fast.get(t) ?? 0) + 0.5 * Math.max(-4, Math.min(4, z[s])));
          const f = evForm.get(t);
          evForm.set(t, f && f.code === m.eventCode ? { code: m.eventCode, sum: f.sum + Math.max(-4, Math.min(4, z[s])), n: f.n + 1 } : { code: m.eventCode, sum: Math.max(-4, Math.min(4, z[s])), n: 1 });
          lastFail.set(t, failed[s] ? 1 : 0);
          sinceFail.set(t, failed[s] ? 0 : (sinceFail.get(t) ?? 10) + 1);
          // Defense proxy: how far the opponents fell short of their own expectation (positive = they underperformed).
          defense.set(t, 0.8 * (defense.get(t) ?? 0) + 0.2 * Math.max(-4, Math.min(4, -z[o])));
          lastNp.set(t, m[s].np / Math.max(1, m[s].teams.length) - np(book.get(t)));
        }
        if (m[s].teams.length > 1) { const key = pairKey(m[s].teams); pairs.set(key, (pairs.get(key) ?? 0) + 1); }
      }
      book.update(m);
    }
    i = j;
  }
}
writeFileSync(out, gzipSync(JSON.stringify(rows)));
console.log(JSON.stringify({ rows: rows.length, pop, overrides: JSON.parse(overrides) }));
