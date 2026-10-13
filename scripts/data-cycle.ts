// One background data cycle (sync → stats → packs), run as a child process of
// the server when DATA_CYCLE=child. See server/data/cycle.ts.
import "../server/env.js";
import { configure } from "../server/db.js";
import { runCycle } from "../server/data/cycle.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);
await configure(); // same busy wait as the server: both processes write this file
await runCycle(log);
process.exit(0);
