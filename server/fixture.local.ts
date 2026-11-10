// Scratch: write src/prerender/compare.fixture.json from the local database (not committed; *.local.ts is ignored).
import { writeFileSync } from "node:fs";
import "./api/searchFacts.js"; // first: teams.ts and searchFacts.ts import each other
import { compareAnswer } from "./api/teams.js";
import { siteMeta } from "./api/meta.js";
import { compareApiPath } from "../src/shared/compareUrl.js";
const teams = ["4215", "7149"], season = 2025;
const key = compareApiPath(teams, season);
const [d, meta] = await Promise.all([compareAnswer(teams.map(Number), season, 2026), siteMeta()]);
const data = JSON.parse(JSON.stringify({ "/api/meta": meta, [key]: d }));
writeFileSync("src/prerender/compare.fixture.json", JSON.stringify(data, null, 0) + "\n");
console.log(Object.keys(data), d.teams.map((t: any) => `${t.team.number} ${t.team.name} opr=${t.stats?.opr.np.value}`), "meetings", d.meetings.length);
process.exit(0);
