// Recompute stats, engine ratings, the calibration ledger and the search index.
//   npm run stats                    all seasons (backtest only if missing)
//   npm run stats -- --backtest      also rebuild the walk-forward backtest ledger
//   npm run stats -- --season 2026   one season's stats
import "../server/env.js";
import { migrate } from "../server/db.js";
import { runStats } from "../server/stats/job.js";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i === -1 ? undefined : process.argv[i + 1]; };
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
await migrate();
const t0 = Date.now();
await runStats({ seasons: arg("season") ? [Number(arg("season"))] : undefined, backtest: process.argv.includes("--backtest") ? true : undefined, log });
log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
