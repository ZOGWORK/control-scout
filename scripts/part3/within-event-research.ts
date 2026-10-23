// Engine program Part 3, step 1 (measurement): after the ratings have already learned from a team's
// earlier matches at this event, do its alliance's misses still lean the same way? If today's misses
// predict the next miss, the ratings under-react within an event and an event-local layer can help;
// if not (or negatively), they already react enough.
//
// For every predicted alliance (2 robots) at a rated event: per phase, the miss (actual − expected) is
// regressed on the robots' mean earlier misses at this event (each robot's share of its alliances'
// misses, averaged over its earlier matches here), split by how many earlier matches here and by the
// robots' event of the season. Opponent-adjusted by construction: expectations come from the book.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part3/within-event-research.ts [--out <file.json>]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const M = FITTED_MODEL;
const PH = ["auto", "teleop", "endgame", "np"] as const;
type Ph = (typeof PH)[number];
const book = new RatingBook(M.rating);
interface Obs { season: number; k: number; ordinal: number; x: Record<Ph, number>; y: Record<Ph, number> }
const obs: Obs[] = [];

for (const s of [2023, 2024, 2025]) {
  const { matches, unrated, byCode } = await seasonCorpus(s);
  book.startSeason(s);
  /** team → { event, misses per phase this event } */
  const today = new Map<number, { code: string; miss: Record<Ph, number>[] }>();
  const events = new Map<number, string[]>();
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    const region = m.region ?? byCode.get(m.eventCode)?.region;
    const sides = [m.red, m.blue].map((al) => ({ al, exp: book.withRegion(region, () => book.allianceExpectation(al.teams)) }));
    for (const { al, exp } of sides) {
      const miss: Record<Ph, number> = { auto: al.auto - exp.auto, teleop: al.teleop - exp.teleop, endgame: al.endgame - exp.endgame, np: al.np - exp.np };
      if (predictable(m) && m.level === "qual") {
        const prior = al.teams.map((t) => { const d = today.get(t); return d && d.code === m.eventCode ? d.miss : []; });
        const k = Math.min(...prior.map((p) => p.length));
        if (k >= 1) {
          const x = Object.fromEntries(PH.map((p) => [p, prior.reduce((a, ms) => a + ms.reduce((b, v) => b + v[p], 0) / ms.length / 2, 0) * 2])) as Record<Ph, number>;
          const ordinal = Math.min(...al.teams.map((t) => (events.get(t) ?? []).indexOf(m.eventCode) + 1 || (events.get(t)?.length ?? 0) + 1));
          obs.push({ season: s, k, ordinal, x, y: miss });
        }
      }
      for (const t of al.teams) {
        const d = today.get(t);
        const share = Object.fromEntries(PH.map((p) => [p, miss[p] / al.teams.length])) as Record<Ph, number>;
        if (d && d.code === m.eventCode) d.miss.push(share); else today.set(t, { code: m.eventCode, miss: [share] });
        const ev = events.get(t) ?? []; if (!ev.includes(m.eventCode)) { ev.push(m.eventCode); events.set(t, ev); }
      }
    }
    book.update(m);
  }
  console.log(`${s}: ${obs.filter((o) => o.season === s).length} alliances with earlier matches at the event`);
}

const ols = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxy / sxx; const res = y.map((v, i) => v - my - b * (x[i] - mx)); const s2 = res.reduce((a, e) => a + e * e, 0) / (n - 2);
  return { n, slope: +b.toFixed(4), se: +Math.sqrt(s2 / sxx).toFixed(4), meanMiss: +my.toFixed(2) };
};
const groups: [string, (o: Obs) => boolean][] = [
  ["all", () => true], ["k=1-2", (o) => o.k <= 2], ["k=3-5", (o) => o.k >= 3 && o.k <= 5], ["k=6+", (o) => o.k >= 6],
  ["1st event", (o) => o.ordinal === 1], ["later events", (o) => o.ordinal > 1],
];
const out: Record<string, unknown> = {};
for (const s of [2024, 2025, "all"] as const) {
  for (const [g, f] of groups) {
    const O = obs.filter((o) => (s === "all" || o.season === s) && f(o));
    out[`${s}|${g}`] = Object.fromEntries(PH.map((p) => [p, ols(O.map((o) => o.x[p]), O.map((o) => o.y[p]))]));
    console.log(String(s).padEnd(5), g.padEnd(13), PH.map((p) => { const r = (out[`${s}|${g}`] as any)[p]; return `${p} ${r.slope}±${r.se}`; }).join("  "), `n=${O.length}`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
