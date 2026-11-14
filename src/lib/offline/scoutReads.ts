// The scouting pages' reads with no signal (the offline + Lite brief, Phase 3): answered from the last answer this
// device loaded (kept.ts) and the event-day bundles on it (bundles.ts). Loaded lazily by answer.ts, only once a read
// found no network. Every answer is the server's own JSON (kept, or inside a bundle), marked with when it was loaded;
// nothing here computes a number. Back online, each page asks the server again (api.ts's probe).
//
// - /api/events?season=…: the kept list (that exact one, else the season's whole list kept by the event picker,
//   narrowed by `q` the way the server narrows it: name, code or city), plus every event this device has a bundle
//   for, so a downloaded event can always be picked.
// - /api/shortlist?teams=…: each team's row from any kept shortlist answer of that season (a team added with no signal
//   was usually kept with the event's own teams: warmScoutReads), else its name and place from a bundle's field with
//   no stats (never a guess), so a team added offline is on the list, not missing from it.
// - /api/teams/:n/matches?season=…: kept, else the team's matches at the events bundled on this device.
// - Any other kept path (pick ratings, an event forecast, a profile, the scouting alliance views): the kept copy.
import type { EventListItem, EventSummary, MatchView, ShortlistTeam } from "../../shared/api";
import type { EventBundle, SavedBundle } from "../../shared/eventBundle";
import { savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";
import { keptAnswer, keptPaths } from "./kept";
import { markOffline, type OfflineSource } from "./saved";

const BASE = "http://offline.invalid";
const int = (s: string | null) => (s && /^\d+$/.test(s) ? Number(s) : null);
const seasonIn = (path: string) => int(new URL(path, BASE).searchParams.get("season")) ?? (Number(/\/(\d{4})\//.exec(path)?.[1]) || 0);
const kept = (season: number, savedAt: number): OfflineSource => ({ season, savedAt, dataAsOf: null, kept: true });

async function bundlesOf(season: number | null): Promise<{ meta: SavedBundle; bundle: EventBundle }[]> {
  const metas = savedBundles().filter((b) => season == null || b.season === season);
  const got = await Promise.all(metas.map(async (meta) => ({ meta, bundle: await loadBundle(meta.season, meta.code).catch(() => null) })));
  return got.filter((x): x is { meta: SavedBundle; bundle: EventBundle } => !!x.bundle);
}

/** A bundle's event as a row of the event list (the list leaves the detail-only fields out, as the server does). */
export function listItemOf(e: EventSummary): EventListItem {
  const { venue: _v, divisionCode: _d, region: _r, remote: _m, ...rest } = e;
  const { league: _l, address: _a, website: _w, livestream: _ls, timezone: _t, source: _s, stream: _st, ...item } = rest as EventSummary & Record<string, unknown>;
  return item as EventListItem;
}

/** The server's own `q` (server/api/events.ts listEvents): name, code or city contains it, any case. */
const matchesQ = (e: EventListItem, q: string) => [e.name, e.code, e.city].some((x) => (x ?? "").toLowerCase().includes(q));

async function offlineEventList(path: string): Promise<{ events: EventListItem[] } | null> {
  const url = new URL(path, BASE);
  const season = int(url.searchParams.get("season"));
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Math.min(3000, int(url.searchParams.get("limit")) ?? 2000);
  let got = await keptAnswer<{ events: EventListItem[] }>(path);
  if (!got) {
    // The season's whole list (the event picker's), narrowed below.
    for (const k of keptPaths((p) => p.startsWith("/api/events?"))) {
      const u = new URL(k.path, BASE);
      if (int(u.searchParams.get("season")) !== season || u.searchParams.get("q") || u.searchParams.get("type") || u.searchParams.get("region") || u.searchParams.get("from") || u.searchParams.get("to")) continue;
      got = await keptAnswer<{ events: EventListItem[] }>(k.path);
      if (got) break;
    }
  }
  const bundles = await bundlesOf(season);
  if (!got && !bundles.length) return null;
  const events = [...(got?.data.events ?? [])];
  const have = new Set(events.map((e) => e.code.toUpperCase()));
  for (const { bundle } of bundles) if (!have.has(bundle.event.event.code.toUpperCase())) events.push(listItemOf(bundle.event.event));
  const shown = (q ? events.filter((e) => matchesQ(e, q)) : events)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name)).slice(0, limit);
  const savedAt = got?.savedAt ?? Math.max(...bundles.map((b) => b.meta.savedAt));
  return markOffline({ ...(got?.data ?? {}), events: shown }, kept(season ?? 0, savedAt));
}

/** A row with nothing but who the team is: its stats need the server (shown as —, never guessed). */
function bareRow(team: number, name: string | null, place: string): ShortlistTeam {
  return {
    team, name, place, opr: null, oprRank: null, of: null, rating: null, ratingSd: null, record: null,
    lastEvent: null, nextEvent: null, breakdown: { auto: null, teleop: null, endgame: null, event: null }, events: [],
  };
}

async function offlineShortlist(path: string): Promise<{ season: number; teams: ShortlistTeam[] } | null> {
  const url = new URL(path, BASE);
  const season = int(url.searchParams.get("season"));
  const teams = (url.searchParams.get("teams") ?? "").split(",").map((t) => int(t.trim())).filter((t): t is number => t != null && t > 0);
  if (season == null || !teams.length) return null;
  const want = new Set(teams);
  const rows = new Map<number, ShortlistTeam>();
  let oldest = Infinity;
  // This exact answer first, then every other kept one of the season, newest first.
  const paths = [path, ...keptPaths((p) => p.startsWith("/api/shortlist?") && p !== path).map((k) => k.path)];
  for (const p of paths) {
    if (rows.size === want.size) break;
    if (seasonIn(p) !== season) continue;
    const got = await keptAnswer<{ teams: ShortlistTeam[] }>(p);
    if (!got) continue;
    let used = false;
    for (const r of got.data.teams ?? []) if (want.has(r.team) && !rows.has(r.team)) { rows.set(r.team, r); used = true; }
    if (used) oldest = Math.min(oldest, got.savedAt);
  }
  const bundles = rows.size < want.size ? await bundlesOf(season) : [];
  const field = new Map<number, { name: string | null; place: string }>();
  for (const { bundle } of bundles) for (const f of bundle.event.field) {
    if (!field.has(f.team)) field.set(f.team, { name: f.name, place: [f.city, f.state].filter(Boolean).join(", ") });
  }
  // Nothing known about any of them: still listed (a team added with no signal must not vanish), by number only,
  // marked as loaded at no time (OfflineNote says the stats need a connection, never "just now").
  if (!Number.isFinite(oldest)) oldest = 0;
  const out = teams.map((t) => rows.get(t) ?? bareRow(t, field.get(t)?.name ?? null, field.get(t)?.place ?? ""));
  return markOffline({ season, teams: out }, kept(season, oldest));
}

async function bundleTeamMatches(team: number, season: number | null): Promise<{ team: number; season: number; matches: MatchView[] } | null> {
  const bundles = (await bundlesOf(season)).filter(({ bundle }) => bundle.event.field.some((f) => f.team === team));
  if (!bundles.length) return null;
  const { meta } = bundles[0];
  const has = (m: MatchView) => [...m.red.teams, ...m.blue.teams].some((t) => t.number === team);
  const matches = bundles.flatMap(({ bundle }) => bundle.event.matches.filter(has));
  return markOffline({ team, season: meta.season, matches }, { season: meta.season, savedAt: meta.savedAt, dataAsOf: meta.dataAsOf, bundle: { builtAt: meta.builtAt, name: meta.name } });
}

/** The scouting pages' answer for a read with no signal, or null when this device holds none. */
export async function scoutReadAnswer(path: string): Promise<unknown | null> {
  const url = new URL(path, BASE);
  if (url.pathname === "/api/events") return offlineEventList(path);
  if (url.pathname === "/api/shortlist") return offlineShortlist(path);
  const got = await keptAnswer<object>(path);
  if (got) return markOffline(got.data, kept(seasonIn(path), got.savedAt));
  const m = /^\/api\/teams\/(\d{1,6})\/matches$/.exec(url.pathname);
  if (m) return bundleTeamMatches(Number(m[1]), int(url.searchParams.get("season")));
  return null;
}
