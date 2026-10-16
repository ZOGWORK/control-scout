// Control Scout's native walk-forward backtest (server/stats/job.ts backtest)
// run with the workspace engine against a COPY of the pinned snapshot DB.
// usage (from the control-scout repository root):
//   DATABASE_URL=file:<copy.db> npx tsx packages/predict-engine/validation/scout-backtest.mts
import "../../../server/env.ts";
import { migrate } from "../../../server/db.ts";
import { backtest } from "../../../server/stats/job.ts";
import { PREDICT_SEASONS } from "../../../server/data/seasons.ts";
import { ENGINE_VERSION } from "@control-scout/predict-engine";

await migrate();
const t0 = Date.now();
await backtest(PREDICT_SEASONS, (m) => console.log(m));
console.log(JSON.stringify({ engine: ENGINE_VERSION, seasons: PREDICT_SEASONS, seconds: (Date.now() - t0) / 1000 }));
