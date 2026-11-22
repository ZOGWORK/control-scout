// Reads the YouTube storyboard spec of each recording search cuts clips from, and hands the specs to the live server
// (server/videos/storyboards.ts), so a grid of clips from one stream shows each match's own frame. Run at home: YouTube
// shows the VM a bot check instead of the watch page. The clip autopilot runs it after its sweep (docs/clip-autopilot.md);
// by hand:
//   npx tsx scripts/storyboards.ts --db .data/autopilot/snapshot.db [--max 150] [--days 30] [--dry]
// --db    a snapshot of the live database (the autopilot's): which recordings exist, and which have a spec already
// --max   most videos read this run (newest seasons first), one page every 1.5 s
// --days  a spec older than this is read again
// --dry   read, say what would be handed over, send nothing (and note nothing)
// One watch page per video, as a browser opens it; a bot check or a refused page stops the run (read again next time).
// A video whose page has no storyboard (live, upcoming, private, removed) is noted in .data/autopilot/storyboards-none.json
// and left a while (scripts/lib/storyboardQueue.ts), so it never takes every run's budget.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { noteRun, wanted, type NoneSeen } from "./lib/storyboardQueue";

const argv = process.argv.slice(2);
const opt = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const DB = opt("db"), MAX = Number(opt("max") ?? 150), DAYS = Number(opt("days") ?? 30), DRY = argv.includes("--dry");
if (!DB) { console.error("--db: a snapshot of the live database"); process.exit(2); }
if (!Number.isInteger(MAX) || MAX < 1 || !(DAYS > 0)) { console.error("--max: 1 or more; --days: more than 0"); process.exit(2); }
process.env.DATABASE_URL = `file:${DB.replace(/\\/g, "/")}`;
process.env.CS_NO_SCHEDULER = "1";

const { all } = await import("../server/db.js");
const { seasonRecordings } = await import("../server/videos/recordings.js");
const { parseSpec } = await import("../server/videos/storyboards.js");

const NONE_FILE = ".data/autopilot/storyboards-none.json";
let none: NoneSeen = {};
try { if (existsSync(NONE_FILE)) none = JSON.parse(readFileSync(NONE_FILE, "utf8")) as NoneSeen; } catch { none = {}; }

/** Every recording's video (each day of it), newest season first. */
const seasons = (await all<{ season: number }>("SELECT DISTINCT season FROM events ORDER BY season DESC")).map((r) => Number(r.season));
const ids: string[] = [];
for (const s of seasons) {
  for (const r of (await seasonRecordings(s, true).catch(() => new Map())).values()) for (const d of [r, ...(r.more ?? [])]) ids.push(d.videoId);
}
const fresh = new Set((await all<{ video_id: string }>(`SELECT video_id FROM video_storyboards WHERE read_at >= datetime('now', '-${Math.floor(DAYS)} days')`).catch(() => [])).map((r) => String(r.video_id)));
const want = wanted(ids, fresh, none, Date.now(), MAX);
console.log(`${new Set(ids).size} recordings, ${fresh.size} with a fresh storyboard, ${Object.keys(none).length} noted without one; reading ${want.length}`);

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const rows: { videoId: string; spec: string }[] = [];
const without: { id: string; live: boolean }[] = [];
for (const id of want) {
  let html: string;
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" } });
    if (!r.ok) { console.log(`${id}: HTTP ${r.status}; stopping (read again next run)`); break; }
    html = await r.text();
  } catch (e) { console.log(`${id}: ${(e as Error).message}; stopping`); break; }
  if (/confirm you.{1,3}re not a bot/i.test(html)) { console.log(`${id}: YouTube asked for a bot check; stopping (read again next run)`); break; }
  const m = /"playerStoryboardSpecRenderer":\{"spec":"((?:[^"\\]|\\.)*)"/.exec(html);
  const spec = m ? (JSON.parse(`"${m[1]}"`) as string) : null;
  if (spec && parseSpec(id, spec)) rows.push({ videoId: id, spec });
  else {
    const live = /"isLive":true|"isUpcoming":true|LIVE_STREAM_OFFLINE/.test(html);
    without.push({ id, live });
    console.log(`${id}: no storyboard (${/"status":"([A-Z_]+)"/.exec(html)?.[1] ?? "no player"}${live ? ", live or upcoming" : ""})`);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
console.log(`${rows.length} storyboards read, ${without.length} videos without one`);
if (DRY) { if (rows.length) console.log(`would hand the server ${rows.length} storyboards: ${rows.map((r) => r.videoId).join(" ")}`); process.exit(0); }
// The videos without one are noted whatever happens to the delivery: they'd have none again.
const noteNone = (read: string[]) => { mkdirSync(dirname(NONE_FILE), { recursive: true }); writeFileSync(NONE_FILE, JSON.stringify(noteRun(none, read, without, Date.now()))); };
if (!rows.length) { noteNone([]); process.exit(0); }

// The autopilot's own way in: a dot-file in the auto-reads inbox as the app's user, renamed in when whole.
const HOST = process.env.AUTOPILOT_SSH ?? "ubuntu@132.145.202.89", KEY = process.env.AUTOPILOT_SSH_KEY ?? join(homedir(), ".ssh", "oracle-controlpoint");
const INBOX = "/opt/control-scout/shared/data/auto-reads-inbox";
const name = `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${hostname().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40)}-storyboards`;
const cmd = `sudo -u controlscout sh -c 'mkdir -p ${INBOX} && cat > ${INBOX}/.${name}.tmp && mv ${INBOX}/.${name}.tmp ${INBOX}/${name}.json'`;
const r = spawnSync("ssh", ["-o", "BatchMode=yes", "-i", KEY, HOST, cmd], { input: JSON.stringify({ kind: "storyboards", rows, source: `${hostname()} storyboards` }), encoding: "utf8", timeout: 300_000 });
// Not sent (ssh missing, timed out, killed, or a failed exit): said so, and the run fails; the specs are read again.
if (r.error || r.signal || r.status !== 0) {
  noteNone([]);
  console.log(`couldn't hand them to the server (${r.error?.message ?? (r.signal ? `ssh ended by ${r.signal}` : `ssh exit ${r.status}`)}): ${r.stderr?.trim() ?? ""}`);
  process.exit(1);
}
noteNone(rows.map((x) => x.videoId));
console.log(`${rows.length} storyboards handed to the server (${name}.json)`);
process.exit(0);
