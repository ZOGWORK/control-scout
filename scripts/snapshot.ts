// Build data/snapshot.db.br: the public FTC data, compressed, shipped with the
// app so a fresh server (e.g. Render's free plan, whose disk is wiped on every
// restart) has data from its first boot — no database service or secrets needed.
//
//   npm run snapshot
//
// Public data only: accounts, sessions, email codes, personal state and
// scouting entries are emptied first, whatever the local database holds.
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { constants, createBrotliCompress } from "node:zlib";
import { createClient } from "@libsql/client";
import "../server/env.js";
import { env } from "../server/env.js";
import { all } from "../server/db.js";

import { PRIVATE_TABLES as PRIVATE } from "../server/data/snapshot.js";
const tmp = join(env.dataDir, "snapshot-build.db");
const out = join(process.cwd(), "data", "snapshot.db.br");

if (existsSync(tmp)) rmSync(tmp);
await all("VACUUM INTO ?", [tmp.replace(/\\/g, "/")]); // consistent copy, WAL included
const c = createClient({ url: `file:${tmp.replace(/\\/g, "/")}` });
for (const t of PRIVATE) await c.execute(`DELETE FROM ${t}`);
await c.execute("DELETE FROM kv WHERE key LIKE 'packs:%'"); // packs aren't shipped
await c.execute("PRAGMA journal_mode = DELETE");
await c.execute("VACUUM");
const counts = await Promise.all(["teams", "events", "matches", "predictions"].map(async (t) => `${t} ${Number((await c.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n).toLocaleString()}`));
c.close();

mkdirSync(join(process.cwd(), "data"), { recursive: true });
await pipeline(createReadStream(tmp), createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), createWriteStream(out));
rmSync(tmp);
console.log(`Wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB): ${counts.join(", ")}`);
