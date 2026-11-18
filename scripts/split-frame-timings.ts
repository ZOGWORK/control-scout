// Split the frame reader's rows into one file a season: server/data/frameTimings/<season>.ts, the season of the row's
// event, so readers of different seasons (scripts/video-frames.ts --season N) never write the same file. The types and
// all the logic stay in server/data/frameTimings.ts, which imports the season files and serves their rows together.
//
//   npx tsx scripts/split-frame-timings.ts --db <copy of the live database>
//
// It takes every row it finds: rows still in frameTimings.ts's own data section (a data PR from before the split) and
// rows already in a season file. A row in a season file stays in that file. A row in frameTimings.ts goes to the
// season whose recording links name its video for its event (official videos, owner streams, broadcasts, stream
// links, the event's livestream). A row no link places, or that links place in more than one season, stops the run
// before anything is written.
//
// Rows only move: the files it writes are read back and must hold the same rows, unchanged. It also writes
// server/data/frameTimings.split.json, the pinned list frameTimings.split.test.ts checks every row against. Run it
// again (no --db needed once every row is in a season file) to re-pin a row rewritten on the day it was pinned.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { isDeepStrictEqual } from "node:util";
import { dataRows } from "./lib/videoFrames.js";

type Row = { videoId: string; code: string; checked: string };
const MAIN = "server/data/frameTimings.ts";
const DIR = "server/data/frameTimings";
const PINS = "server/data/frameTimings.split.json";
const MARK = "// --- Data";
/** Seasons that always have a file, empty or not: the ones the readers write. */
const SEASONS = [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const at = process.argv.indexOf("--db");
const dbFile = at > 0 ? process.argv[at + 1] : undefined;
const key = (f: Row) => `${f.videoId}|${f.code}`;

const main = readFileSync(MAIN, "utf8");
if (!main.includes(MARK)) { console.error(`${MAIN}: no "${MARK}" line`); process.exit(2); }
const inMain = dataRows<Row>(main);
const seasonOf = new Map<string, number>();
const rows = new Map<string, Row>();
const add = (f: Row, where: string) => {
  const prior = rows.get(key(f));
  if (prior && !isDeepStrictEqual(prior, f)) { console.error(`${key(f)}: two different rows (one in ${where})`); process.exit(2); }
  rows.set(key(f), f);
};
const files = existsSync(DIR) ? readdirSync(DIR).filter((n) => /^\d{4}\.ts$/.test(n)).sort() : [];
for (const name of files) {
  const season = Number(name.slice(0, 4));
  for (const f of dataRows<Row>(readFileSync(`${DIR}/${name}`, "utf8"))) {
    // A row in two season files is in one too many, whichever it is: nothing here can tell which.
    if (seasonOf.has(key(f))) { console.error(`${key(f)}: in ${seasonOf.get(key(f))}.ts and ${name}`); process.exit(2); }
    add(f, name);
    seasonOf.set(key(f), season);
  }
}
for (const f of inMain) add(f, MAIN);

// Place the rows frameTimings.ts still holds.
const loose = inMain.filter((f) => !seasonOf.has(key(f)));
if (loose.length) {
  if (!dbFile) { console.error(`${loose.length} rows in ${MAIN} need a season: give --db <copy of the live database>`); process.exit(2); }
  const db = createClient({ url: `file:${dbFile}` });
  const stuck: string[] = [];
  for (const f of loose) {
    const found = new Set<number>();
    for (const t of ["official_videos", "event_streams", "event_broadcasts", "event_stream_links"]) {
      const r = await db.execute({ sql: `SELECT DISTINCT season FROM ${t} WHERE code = ? AND video_id = ?`, args: [f.code, f.videoId] });
      for (const x of r.rows) found.add(Number(x.season));
    }
    const ev = await db.execute({ sql: "SELECT season FROM events WHERE code = ? AND instr(livestream, ?) > 0", args: [f.code, f.videoId] });
    for (const x of ev.rows) found.add(Number(x.season));
    if (found.size === 1) seasonOf.set(key(f), [...found][0]);
    else stuck.push(`${key(f)}: ${found.size ? `linked in ${[...found].join(", ")}` : "no link to it"}`);
  }
  if (stuck.length) { console.error(`rows with no single season (nothing written):\n  ${stuck.join("\n  ")}`); process.exit(2); }
}

// The season files, each sorted as scripts/video-frames.ts writes them.
const all = [...rows.values()];
const seasons = [...new Set([...SEASONS, ...seasonOf.values()])].sort((a, b) => a - b);
// A first split (or one after the season files were deleted to re-split) starts with no folder.
mkdirSync(DIR, { recursive: true });
for (const s of seasons) {
  const list = all.filter((f) => seasonOf.get(key(f)) === s).sort((a, b) => a.code.localeCompare(b.code) || a.videoId.localeCompare(b.videoId));
  const file = `${DIR}/${s}.ts`;
  const head = existsSync(file) ? readFileSync(file, "utf8").split(MARK)[0] : `// The ${s} season's frame-read match starts: one row per recording and event, the rows of the season the event is
// of. scripts/video-frames.ts --season ${s} writes this file and no other (each season its own file, so readers of
// different seasons never touch the same file). The row type and everything that reads the rows: ../frameTimings.ts.
import type { FrameTiming } from "../frameTimings.js";

`;
  writeFileSync(file, `${head}${MARK} (scripts/video-frames.ts writes from here on) ---\nexport const ROWS: FrameTiming[] = [\n${list.map((f) => `  ${JSON.stringify(f)},`).join("\n")}\n];\n`);
  console.log(`${file}: ${list.length} rows`);
}

// frameTimings.ts: its logic as it is, the season imports before its first export, the rows from the files.
const imports = seasons.map((s) => `import { ROWS as S${s} } from "./frameTimings/${s}.js";`).join("\n");
let logic = main.split(MARK)[0].replace(/^import \{ ROWS as S\d+ \} from "\.\/frameTimings\/\d+\.js";\n/gm, "").replace(/\n\n\n+/g, "\n\n");
const first = logic.indexOf("\nexport ");
logic = `${logic.slice(0, first)}\n${imports}\n${logic.slice(first)}`;
writeFileSync(MAIN, `${logic}${MARK}: one file a season (frameTimings/<season>.ts, the season of the row's event), which scripts/video-frames.ts
// writes, so readers of different seasons never touch the same file. Every caller reads this one list.
export const FRAME_TIMINGS: FrameTiming[] = [${seasons.map((s) => `...S${s}`).join(", ")}];
`);

// Read back: the same rows, unchanged, each once.
const sorted = (list: Row[]) => [...list].sort((a, b) => key(a).localeCompare(key(b)));
const back = seasons.flatMap((s) => dataRows<Row>(readFileSync(`${DIR}/${s}.ts`, "utf8")));
if (dataRows(readFileSync(MAIN, "utf8")).length || !isDeepStrictEqual(sorted(back), sorted(all))) { console.error("the files written don't hold the same rows"); process.exit(1); }

// The pinned rows: each one's video and event, the start of the sha-256 of the row as written, its `checked`, and the
// season whose file holds it.
const hash = (f: Row) => createHash("sha256").update(JSON.stringify(f)).digest("hex").slice(0, 12);
writeFileSync(PINS, `${JSON.stringify(sorted(all).map((f) => `${key(f)} ${hash(f)} ${f.checked} ${seasonOf.get(key(f))}`), null, 0).replace(/","/g, '",\n"').replace(/^\[/, "[\n").replace(/\]$/, "\n]")}\n`);
console.log(`${all.length} rows (${loose.length} moved out of ${MAIN}); pinned in ${PINS}`);
