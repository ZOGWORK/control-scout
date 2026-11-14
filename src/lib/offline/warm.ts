// Ask, while there's signal, for the reads the scouting pages will need at each event this device has a bundle for
// (the offline + Lite brief, Phase 3), so they're kept (kept.ts) before the venue's wifi goes: the season's event
// list as the Scout event picker asks for it, the event's pick ratings and stored projections, and every one of its
// teams' shortlist rows (a team added to the shortlist with no signal then shows its stats). Each answer is the
// server's own, kept as it came. At most once per bundle every WARM_EVERY_MS; nothing at all with no network.
import { ApiError, apiFetch, qs } from "../api";
import { keptOwner } from "./kept";
import { savedBundles } from "./bundleMeta";
import { deviceOffline } from "./online";
import type { SavedBundle } from "../../shared/eventBundle";

/** Enough for any season's every event (the list's own default is 2,000). */
export const ALL_EVENTS = 3000;
/** The Scout event picker's list: every event type, as many as there are (EventChooser). */
export const chooserEventsPath = (season: number) => `/api/events${qs({ season, all: 1, limit: ALL_EVENTS })}`;
/** The shortlist's read for a set of teams (ShortlistPage, SharedPicklist): sorted, as they ask. */
export const shortlistPath = (teams: readonly number[], season: number) => `/api/shortlist${qs({ teams: [...teams].sort((a, b) => a - b).join(","), season })}`;
/** The server takes up to this many teams in one shortlist read. */
const SHORTLIST_MAX = 100;

export const WARM_EVERY_MS = 30 * 60_000;
const STAMP = "cs-kept-warm";

/** The reads kept for one bundled event. */
export function warmPaths(b: Pick<SavedBundle, "season" | "code" | "teams">): string[] {
  const code = encodeURIComponent(b.code);
  const teams = [...(b.teams ?? [])].sort((x, y) => x - y);
  const chunks: number[][] = [];
  for (let i = 0; i < teams.length; i += SHORTLIST_MAX) chunks.push(teams.slice(i, i + SHORTLIST_MAX));
  return [
    chooserEventsPath(b.season),
    `/api/events/${b.season}/${code}/pick-ratings`,
    `/api/projections/${b.season}/${code}`,
    ...chunks.map((c) => shortlistPath(c, b.season)),
  ];
}

function stamps(): Record<string, number> {
  try { const v = JSON.parse(localStorage.getItem(STAMP) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

let running: Promise<void> | null = null;
/** A forced pass asked for while one was running (a bundle downloaded meanwhile): run once that one ends. */
let again = false;
/** Warm every bundled event not warmed in the last WARM_EVERY_MS for this account (kept answers are per account);
 *  `force`: a bundle just downloaded or updated. */
export function warmScoutReads(force = false, now = Date.now()): Promise<void> {
  if (deviceOffline()) return Promise.resolve();
  if (running) {
    if (force) again = true;
    return running;
  }
  running = (async () => {
    const seen = stamps();
    const stamp = (b: SavedBundle) => `${keptOwner()}|${b.season}:${b.code}:${b.version}`;
    const due = savedBundles().filter((b) => force || now - (seen[stamp(b)] ?? 0) > WARM_EVERY_MS);
    // One season's event list is the same for all its bundles: asked once.
    const asked = new Set<string>();
    for (const b of due) {
      const paths = warmPaths(b).filter((p) => !asked.has(p));
      paths.forEach((p) => asked.add(p));
      // Done unless a read found no network: an answer the server refused (a feature switched off) won't change by asking again.
      const got = await Promise.all(paths.map((p) => apiFetch(p).then(() => true, (e) => !(e instanceof ApiError && e.offline))));
      if (got.every(Boolean)) seen[stamp(b)] = now;
    }
    try { localStorage.setItem(STAMP, JSON.stringify(seen)); } catch { /* storage full: warmed again next time */ }
  })().finally(() => {
    running = null;
    if (again) { again = false; void warmScoutReads(true); }
  });
  return running;
}
