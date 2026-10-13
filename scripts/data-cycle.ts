// One background data cycle (sync → stats → packs), run as a child process of
// the server when DATA_CYCLE=child. See server/data/cycle.ts.
import "../server/env.js";
import { runCycle } from "../server/data/cycle.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
await runCycle(log);
process.exit(0);
