// Usage statistics from the database, printed (the same numbers as
// GET /api/stats/summary, no token needed on the server itself).
//
//   npm run stats:report            # last 30 days
//   npm run stats:report -- 7       # last 7 days
//   npm run stats:report -- --json  # the API's JSON
import "../server/env.js";
import { migrate } from "../server/db.js";
import { statsSummary } from "../server/analytics.js";

const args = process.argv.slice(2);
const days = Math.min(366, Math.max(1, Number(args.find((a) => /^\d+$/.test(a)) ?? 30)));
await migrate();
const s = await statsSummary(days);
if (args.includes("--json")) { console.log(JSON.stringify(s, null, 2)); process.exit(0); }

const table = (title: string, rows: Record<string, unknown>[], key: string, value: string) => {
  console.log(`\n${title}`);
  if (!rows.length) { console.log("  (none)"); return; }
  const w = Math.max(...rows.map((r) => String(r[key] || "(none)").length));
  for (const r of rows) console.log(`  ${String(r[key] || "(none)").padEnd(w)}  ${String(r[value]).padStart(7)}`);
};
console.log(`Usage statistics, ${s.from} to ${s.to} (${s.days} days, UTC)`);
console.log(`  Page views ${s.totals.views}   Sessions ${s.totals.sessions}`);
table("By day (views)", s.daily, "day", "views");
table("Top pages (views)", s.topPaths, "path", "views");
table("Top referrers (sessions)", s.topReferrers, "host", "sessions");
table("Screens (views)", s.screens, "screen", "views");
table("Languages (views)", s.languages, "lang", "views");
process.exit(0);
