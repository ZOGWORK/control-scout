// Build the offline packs + manifest into <DATA_DIR>/packs (served at /packs).
import "../server/env.js";
import { migrate } from "../server/db.js";
import { buildPacks } from "../server/packs/build.js";
await migrate();
const t0 = Date.now();
// --lock-held: the parent (the owner's Rebuild packs) holds the data lock for the whole build (buildFull).
await buildPacks((m) => console.log(m), { lockHeld: process.argv.includes("--lock-held") });
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
