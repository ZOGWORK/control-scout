// Consistent single-file copy of the local database for moving it to a server:
// `VACUUM INTO` includes anything still in the WAL, unlike copying scout.db.
//   npm run db:export            → .data/scout-export.db
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import "../server/env.js";
import { env } from "../server/env.js";
import { all } from "../server/db.js";

const out = join(env.dataDir, "scout-export.db");
if (existsSync(out)) rmSync(out);
await all("VACUUM INTO ?", [out.replace(/\\/g, "/")]);
console.log(`Wrote ${out}`);
