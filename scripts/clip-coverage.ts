// Clip coverage audit: every event with a linked recording (or FIRST's own match videos), every season, every day /
// part video, every played match: a clip, or why not (server/videos/coverage.ts, the page's own decisions). Reads only.
//
//   DATABASE_URL=file:/path/to/scout.db npx tsx scripts/clip-coverage.ts [out-dir]
//
// Writes <out-dir>/clip-coverage.md (totals, per event, every match without a clip grouped by video and reason, and
// every clip that stands on one signal only), clip-coverage.csv (every played match, one row each) and
// clip-coverage.json. On the VM: run it on a copy of the database (VACUUM INTO), never a second writer on the live one.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { all } from "../server/db.js";
import { seasonRecordings } from "../server/videos/recordings.js";
import { clipCoverage, eventMatchRows } from "../server/videos/coverage.js";
import type { ClipCoverage, CoverageMatch } from "../src/shared/api.js";
import { labelRanges } from "../src/shared/coverage.js";

const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const now = Date.now();

type Row = { season: number; code: string; name: string; c: ClipCoverage };
const events: Row[] = [];
const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
for (const season of seasons) {
  const [recs, full, firstVideo] = await Promise.all([
    seasonRecordings(season), seasonRecordings(season, true),
    all<{ code: string }>("SELECT DISTINCT code FROM matches WHERE season = ? AND video IS NOT NULL AND video != ''", [season]),
  ]);
  const codes = [...new Set([...full.keys(), ...firstVideo.map((r) => String(r.code))])].sort();
  if (!codes.length) continue;
  const info = new Map<string, { name: string; timezone: string | null }>();
  for (let i = 0; i < codes.length; i += 200) {
    const part = codes.slice(i, i + 200);
    for (const e of await all<{ code: string; name: string; timezone: string | null }>(`SELECT code, name, timezone FROM events WHERE season = ? AND code IN (${part.map(() => "?").join(",")})`, [season, ...part])) info.set(String(e.code), { name: String(e.name), timezone: e.timezone });
  }
  const rows = await eventMatchRows(season, codes);
  for (const code of codes) {
    const c = clipCoverage(rows.get(code) ?? [], recs.get(code) ?? null, full.get(code) ?? null, info.get(code)?.timezone, now);
    events.push({ season, code, name: info.get(code)?.name ?? code, c });
  }
  console.error(`${season}: ${codes.length} events`);
}

// --- Totals ---
const matches = events.flatMap((e) => e.c.matches.map((m) => ({ e, m })));
const withClip = matches.filter((x) => x.m.clip).length;
const tally = <T,>(xs: T[], k: (x: T) => string) => { const t = new Map<string, number>(); for (const x of xs) t.set(k(x), (t.get(k(x)) ?? 0) + 1); return [...t].sort((a, b) => b[1] - a[1]); };
const missing = matches.filter((x) => !x.m.clip);
const byState = tally(events, (e) => e.c.state);
const byReason = tally(missing, (x) => x.m.why!.replace(/ \(.*\)$/, "").replace(/^Video .* shorter than its broadcast.*$/, "Video shorter than its broadcast, missing time can't be placed").replace(/^No recording for \w+$/, "No recording for that day"));
const byBasis = tally(matches.filter((x) => x.m.clip), (x) => (x.m.basis ?? "?").replace(/up to \d+ min early/, "up to 15 min early").replace(/its first .* cut off/, "its start cut off"));
const oneSignal = matches.filter((x) => x.m.clip && /^clock only/.test(x.m.basis ?? ""));

const teams = (m: CoverageMatch) => (m.teams?.length ? `${m.teams.slice(0, m.teams.length / 2).join(" ")} v ${m.teams.slice(m.teams.length / 2).join(" ")}` : "");
const md: string[] = [];
md.push(`# Clip coverage audit`, "", `Run ${new Date(now).toISOString()} on ${process.env.DATABASE_URL?.replace(/^file:/, "") ?? "the local database"}.`, "");
md.push(`| | Count |`, `|---|---:|`,
  `| Events checked (a linked recording or FIRST match videos) | ${events.length} |`,
  `| Recording videos checked | ${events.reduce((n, e) => n + e.c.videos.length, 0)} |`,
  `| Played matches checked | ${matches.length} |`, `| With a clip | ${withClip} |`, `| Without a clip | ${missing.length} |`, "");
md.push(`## Events by coverage`, "", `| State | Events |`, `|---|---:|`, ...byState.map(([k, n]) => `| ${k} | ${n} |`), "");
md.push(`## Why matches have no clip`, "", `| Reason | Matches |`, `|---|---:|`, ...byReason.map(([k, n]) => `| ${k} | ${n} |`), "");
md.push(`## What clips stand on`, "", `| Basis | Clips |`, `|---|---:|`, ...byBasis.map(([k, n]) => `| ${k} | ${n} |`), "");
md.push(`## Clips on one signal only (${oneSignal.length})`, "", "Started early by the whole gap because the missing time can't be placed: nothing but the clock places them. Withheld once Step 3's second-signal check lands.", "");
for (const [k, xs] of groupBy(oneSignal, (x) => `${x.e.season} ${x.e.code} · ${x.m.videoId}`)) md.push(`- ${k} (${xs[0].e.name}): ${labelRanges(xs.map((x) => x.m.label))}`);
md.push("", `## Every event with a match missing a clip`, "", "Per event, per video (day · part), per reason: the matches. Every match's teams are in clip-coverage.csv.", "");
for (const e of events.filter((e) => e.c.withClip < e.c.played)) {
  md.push(`### ${e.season} ${e.code} — ${e.name}: ${e.c.withClip} of ${e.c.played} (${e.c.state})`);
  for (const v of e.c.videos) md.push(`- ${v.label} \`${v.videoId}\`: ${v.clipped} of ${v.matches} held${v.why ? ` — ${v.why}` : ""}`);
  for (const d of e.c.daysMissing) md.push(`- ${d.label} ${d.date}: no recording (${d.matches} played)`);
  for (const [k, xs] of groupBy(e.c.matches.filter((m) => !m.clip), (m) => `${m.videoId ?? "no video"}: ${m.why}`)) md.push(`  - ${labelRanges(xs.map((m) => m.label))} · ${k}`);
}
writeFileSync(join(out, "clip-coverage.md"), md.join("\n") + "\n");

const csv = ["season,event,event_name,state,date,match,teams,clip,video_id,basis,reason,why"];
const q = (s: unknown) => { const v = String(s ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
for (const { e, m } of matches) csv.push([e.season, e.code, e.name, e.c.state, m.date, m.label, teams(m), m.clip ? "yes" : "no", m.videoId, m.basis, m.reason, m.why].map(q).join(","));
writeFileSync(join(out, "clip-coverage.csv"), csv.join("\n") + "\n");
writeFileSync(join(out, "clip-coverage.json"), JSON.stringify({ at: new Date(now).toISOString(), events: events.length, matches: matches.length, withClip, without: missing.length, byState, byReason, byBasis, list: events }, null, 0));
console.log(`events ${events.length}, matches ${matches.length}, with clip ${withClip}, without ${missing.length}, one-signal clips ${oneSignal.length}`);

function groupBy<T>(xs: T[], k: (x: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) (m.get(k(x)) ?? m.set(k(x), []).get(k(x))!).push(x);
  return [...m];
}
process.exit(0);
