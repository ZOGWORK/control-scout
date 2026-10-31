// Event-day bundle (docs/event-bundle.md): one download before leaving for the venue, one labelled bundle per
// event on the device. Types and the pure rules, shared by the builder (server/packs/bundle.ts) and the app
// (src/lib/offline/bundles.ts, the Download page, the snapshot fallbacks), kept pure so they're tested without a
// database or a browser.
//
// What's inside, each a section of the manifest (contents, versions, sizes):
//   - event:    the event's slice of the data pack: its detail exactly as the event page reads it (teams,
//               schedule, rankings, alliances, the predictions made for its matches);
//   - ratings:  the season's rating book cut down to the event's teams, so the lite pack's engine predicts any
//               matchup of them in the browser with no signal;
//   - reports:  frozen "Know your match" reports for your team's matches, rendered by the server to
//               self-contained static HTML (no scripts, no data fetches);
//   - picklist: the workspace pick list, frozen the same way (members only);
//   - rules:    the question-box rules reference for the season (src/shared/rules), when it covers it;
//   - venue:    a venue card (event name, venue and address, dates) from the event's own data.
//
// Freshness: the bundle says what time its data is from, everywhere it renders. Live data always takes over the
// moment it loads; the bundle answers only with no signal (lib/api.ts), the shipped rule for packs.
import type { RatingBookData } from "@control-scout/predict-engine";
import type { EventDetail } from "./api";

export const BUNDLE_FORMAT = 1;

export type BundleSectionId = "event" | "ratings" | "reports" | "picklist" | "rules" | "venue";

/** One section of a bundle, as the manifest lists it. */
export interface BundleSection {
  id: BundleSectionId;
  label: string;
  /** This section's own version: a hash of its contents, so an update says what changed. */
  version: string;
  /** Size of the section as stored (uncompressed JSON). */
  bytes: number;
  /** How many things it holds (teams, matches, reports, picks). */
  items: number;
  /** Why it's empty or partial, in a sentence (null: nothing to say). */
  note: string | null;
}

/** GET /api/bundles/:season/:code/manifest: what the one download holds, before it's downloaded. */
export interface BundleManifest {
  format: number;
  season: number;
  code: string;
  name: string;
  /** The event's last day (or first), so a bundle can be pruned once the event is over. */
  end: string | null;
  /** The bundle's version: a hash of every section's version. Same data, same version (no needless updates). */
  version: string;
  builtAt: string;
  /** The newest data inside: the event's last result check on an event day, else the last sync. */
  dataAsOf: string | null;
  engineVersion: string;
  /** Your team (whose matches are in the reports), and the workspace whose pick list and scouting are in it. */
  team: number | null;
  workspace: { id: string; name: string } | null;
  /** The file to download (gzipped JSON) and its SHA-256, checked before it's kept. */
  url: string;
  bytes: number;
  sha256: string;
  sections: BundleSection[];
  /** The event's teams [number, name], so the builder can offer "your team". */
  field: [number, string | null][];
  /** Match keys of the frozen reports inside (qual:0:12 …). */
  reportKeys: string[];
}

/** One frozen report: static HTML, readable with zero JS data fetches. */
export interface HtmlSnapshot {
  /** Match key (qual:0:12) for a report; "picklist" for the pick list. */
  key: string;
  label: string;
  /** Event-local start (as FIRST reports it), for the list. */
  time: string | null;
  html: string;
}

export interface VenueCard {
  name: string;
  typeLabel: string;
  venue: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  start: string | null;
  end: string | null;
  timezone: string | null;
  website: string | null;
  livestream: string | null;
}

/** The rules reference section: pluggable. Its owner fills `html` (self-contained, like the snapshots). */
export interface RulesSection { title: string; version: string; html: string }

/** The bundle file, decoded. */
export interface EventBundle {
  format: number;
  manifest: Omit<BundleManifest, "url" | "bytes" | "sha256">;
  event: EventDetail;
  ratings: RatingBookData | null;
  reports: HtmlSnapshot[];
  picklist: (HtmlSnapshot & { count: number }) | null;
  rules: RulesSection | null;
  venue: VenueCard;
}

/** What the device keeps per bundle (the list in localStorage; the bytes in IndexedDB). */
export interface SavedBundle {
  season: number;
  code: string;
  name: string;
  end: string | null;
  version: string;
  sha256: string;
  bytes: number;
  savedAt: number;
  builtAt: string;
  dataAsOf: string | null;
  team: number | null;
  workspace: { id: string; name: string } | null;
  reports: number;
  /** Which matches' reports it holds (bundles saved before this was noted: absent). */
  reportKeys?: string[];
  picklist: boolean;
}

/** IndexedDB key of an event's bundle: one per event, a new download replaces it. */
export const bundleKey = (season: number, code: string) => `bundle:${season}:${code.toUpperCase()}`;

/** The rating book cut down to these teams: their ratings, reliability, history and event form. The season's
 *  baseline, parameters and regional lifts stay whole (a prediction needs them; they're small). */
export function sliceBook(data: RatingBookData, teams: Iterable<number>): RatingBookData {
  const keep = new Set(teams);
  const mine = <T,>(rows: [number, T][] | undefined) => rows?.filter(([t]) => keep.has(t));
  return {
    ...data,
    ratings: mine(data.ratings)!,
    history: mine(data.history)!,
    ...(data.reliability ? { reliability: mine(data.reliability) } : {}),
    ...(data.events ? { events: mine(data.events) } : {}),
    ...(data.regions ? { regions: { lift: data.regions.lift, pending: data.regions.pending.filter(([t]) => keep.has(t)) } } : {}),
  };
}

/** A stable JSON text for hashing: keys that only say when something was computed (not what) are left out, so the
 *  same data hashes the same on every build and an update means something changed. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (k, v) => (k === "predictedAt" || k === "checkedAt" || k === "builtAt" ? undefined : v));
}

/** When the bundle's data is from (its newest data, else when it was built). */
export const bundleTime = (b: Pick<SavedBundle, "dataAsOf" | "builtAt">): string => b.dataAsOf ?? b.builtAt;

/** The event is over (its last day is before today, in the device's own date): the bundle may be pruned. */
export function bundleFinished(b: Pick<SavedBundle, "end">, now = new Date()): boolean {
  if (!b.end) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return b.end.slice(0, 10) < today;
}

/** "07:12" (24-hour, device time) for a bundle's data time, with the day when it isn't today. */
export function snapshotClock(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return d.toDateString() === now.toDateString() ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

/** How old the data is, short: "just now", "25 min", "3 h 10 min", "2 days". */
export function snapshotAge(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"}`;
}

/** Old enough that a pick list or report shouldn't be trusted without a look at the live one. */
export const STALE_AFTER_MS = 2 * 3600_000;
