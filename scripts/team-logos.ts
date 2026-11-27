// Fetch FIRST's team pictures into team_logos (server/teamLogos.ts). The data cycle does this daily on its own;
// this is for a first fill or a few teams by hand.
//
//   npm run logos                          current + previous season, every team
//   npm run logos -- --teams 4215,8902     only these teams (nothing is removed)
//   npm run logos -- --season 2025         one season's sheet
import "../server/env.js";
import { migrate } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { refreshTeamLogos } from "../server/teamLogos.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

await migrate();
const season = arg("season");
const teams = arg("teams")?.split(",").map(Number).filter((n) => n >= 1);
await refreshTeamLogos({ seasons: season ? [Number(season)] : [CURRENT_SEASON, CURRENT_SEASON - 1], teams, log });
