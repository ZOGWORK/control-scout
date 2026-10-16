// Check every power-rankings week (docs/power-rankings.md): the file format (25 entries, unique
// teams, valid numbers, front-matter, blurbs written), and, when a database with teams is there,
// that every team exists and has played this season. Exits 1 on any error.
//
//   npm run power-rankings:check            # content/power-rankings and the sample weeks
//   npm run power-rankings:check -- content/power-rankings/2026-w43.md
import "../server/env.js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { all, migrate } from "../server/db.js";
import { CONTENT_DIR, SAMPLE_DIR, loadDir } from "../server/powerRankings/store.js";
import { parseRankings, type RankingDoc } from "../server/powerRankings/format.js";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const docs: { where: string; doc: RankingDoc }[] = [];
let failed = false;
const report = (where: string, errors: string[]) => { failed = true; console.error(`✗ ${where}\n  ${errors.join("\n  ")}`); };

if (files.length) {
  for (const f of files) {
    const r = parseRankings(readFileSync(f, "utf8"), basename(f));
    if (r.ok) docs.push({ where: f, doc: r.doc }); else report(f, r.errors);
  }
} else {
  for (const [dir, sample] of [[CONTENT_DIR, false], [SAMPLE_DIR, true]] as const) {
    const l = loadDir(dir, sample);
    for (const e of l.errors) report(`${basename(dir)}/${e.file}`, e.errors);
    for (const d of l.docs) docs.push({ where: `${basename(dir)}/${d.week}.md`, doc: d });
  }
}

// Teams against the database, when there is one with teams in it.
let haveDb = false;
try { await migrate(); haveDb = (await all("SELECT 1 FROM teams LIMIT 1")).length > 0; } catch { /* no database here */ }
for (const { where, doc } of docs) {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (haveDb) {
    const teams = doc.entries.map((e) => e.team);
    const q = teams.map(() => "?").join(",");
    const known = new Set((await all<{ number: number }>(`SELECT number FROM teams WHERE number IN (${q})`, teams)).map((r) => Number(r.number)));
    const played = new Set((await all<{ team: number }>(`SELECT team FROM team_season_stats WHERE season = ? AND matches > 0 AND team IN (${q})`, [doc.season, ...teams])).map((r) => Number(r.team)));
    for (const e of doc.entries) {
      if (!known.has(e.team)) errors.push(`#${e.rank}: there's no team ${e.team} in the database`);
      else if (!played.has(e.team)) warnings.push(`#${e.rank}: team ${e.team} has no matches in the ${doc.season} season yet`);
    }
  }
  if (errors.length) report(where, errors);
  else console.log(`✓ ${where}${haveDb ? "" : " (format only: no database to check teams against)"}`);
  for (const w of warnings) console.warn(`  ! ${w}`);
}
if (!docs.length && !failed) console.log("No week files yet.");
process.exit(failed ? 1 : 0);
