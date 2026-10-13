// Consistent single-file copy of the local database for moving it to a server:
// `VACUUM INTO` includes anything still in the WAL, unlike copying scout.db.
//   npm run db:export            → .data/scout-export.db
// The copy is left in WAL mode, which `turso db import` expects; a plain
// SQLite host (the Oracle VM) opens it either way.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import "../server/env.js";
import { env } from "../server/env.js";
import { all } from "../server/db.js";

const out = join(env.dataDir, "scout-export.db");
const url = out.replace(/\\/g, "/");
if (existsSync(out)) rmSync(out);
await all("VACUUM INTO ?", [url]);
const copy = createClient({ url: `file:${url}` });
await copy.execute("PRAGMA journal_mode = WAL");
await copy.execute("PRAGMA wal_checkpoint(TRUNCATE)");
copy.close();
console.log(`Wrote ${out}`);
