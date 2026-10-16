// Start a new power-rankings week (docs/power-rankings.md): writes content/power-rankings/<week>.md
// with the current top 25 by rating filled in. Every blurb (and the intro) starts as a TODO line
// with the team's numbers; the file won't validate, or show on the site, until each is written.
//
//   npm run power-rankings:new                         # this week (ISO), the newest rated season, published today
//   npm run power-rankings:new -- --week 2026-w43 --published 2026-10-26
//   npm run power-rankings:new -- --season 2025 --force   # replace an existing file
//   npm run power-rankings:new -- --stdout             # print it instead of writing
import "../server/env.js";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { migrate } from "../server/db.js";
import { CONTENT_DIR } from "../server/powerRankings/store.js";
import { latestRatedSeason, newWeekFile } from "../server/powerRankings/scaffold.js";
import { POWER_RANKINGS_SIZE, isWeekId, weekIdOf } from "../src/shared/powerRankings.js";

const args = process.argv.slice(2);
const opt = (f: string) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : undefined; };
const fail = (msg: string) => { console.error(msg); process.exit(1); };

const week = (opt("week") ?? weekIdOf(new Date())).toLowerCase();
if (!isWeekId(week)) fail(`--week ${week}: give an ISO week like 2026-w43`);
const published = opt("published") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(published)) fail(`--published ${published}: give a date like 2026-10-26`);

await migrate();
const season = opt("season") ? Number(opt("season")) : await latestRatedSeason();
if (!season || !Number.isInteger(season)) fail("No season has rated teams yet (run npm run stats), or give --season 2025.");

const { text, teams } = await newWeekFile({ week, season: season!, published });
if (teams < POWER_RANKINGS_SIZE) console.warn(`Only ${teams} rated teams in ${season}: add the rest by hand (a week needs ${POWER_RANKINGS_SIZE}).`);
if (args.includes("--stdout")) { process.stdout.write(text); process.exit(0); }

const dir = opt("dir") ?? CONTENT_DIR;
const file = join(dir, `${week}.md`);
if (existsSync(file) && !args.includes("--force")) fail(`${relative(process.cwd(), file)} already exists (--force replaces it).`);
mkdirSync(dir, { recursive: true });
writeFileSync(file, text);
console.log(`Wrote ${relative(process.cwd(), file)}: ${teams} teams from the ${season} season's ratings.`);
console.log("Next: write the intro and each blurb (replace every TODO), reorder if you like, then npm run power-rankings:check.");
process.exit(0);
