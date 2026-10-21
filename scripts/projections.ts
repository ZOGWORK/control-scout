// Run the projections job by hand: `npm run projections -- <season> <CODE> [CODE…]` simulates those
// events now and stores the runs (as the server's background job would); with no codes, every event
// the job would look at today. Prints each run's simulations and time.
import "../server/env.js";
import { migrate } from "../server/db.js";
import { candidates, projectEvent } from "../server/projections/job.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";

await migrate();
const [seasonArg, ...codes] = process.argv.slice(2);
const season = seasonArg ? Number(seasonArg) : CURRENT_SEASON;
const list = codes.length ? codes.map((c) => c.toUpperCase()) : (await candidates(Date.now(), season)).map((c) => c.code);
if (!list.length) console.log(`No ${season} events to project today.`);
for (const code of list) {
  const r = await projectEvent(season, code, { log: console.log });
  if (r.status !== "ran") console.log(`${code}: ${r.status}${r.status === "skipped" ? ` (${r.reason})` : ""}`);
}
process.exit(0);
