// Build the offline packs + manifest into <DATA_DIR>/packs (served at /packs).
import "../server/env.js";
import { migrate } from "../server/db.js";
import { buildPacks } from "../server/packs/build.js";
await migrate();
const t0 = Date.now();
await buildPacks((m) => console.log(m));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
