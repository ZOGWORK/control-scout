// Model vs field for one event (src/shared/disagreements.ts picks the gaps): the model's rating order
// against the official seeding, from what the event page already loads (its cached detail: the field
// with ranks, OPR and ratings) plus, before seeding here means much, each team's seed at its last event.
//
// Built from the event detail, which is rebuilt whenever the data moves on (a sync or a live result, so
// whenever the rankings change); this is worked out again with it. A finished event's comparison needs a
// replay of the season (ratings as they were at its last match), so that one is stored (kv) until the
// event's own results or ranks change, or the engine does.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all, kvGet, kvSet } from "../db.js";
import { isLegacy } from "../data/seasons.js";
import { cachedEventDetail } from "./events.js";
import { liveForecaster } from "../predict/engine.js";
import type { EventDetail } from "../../src/shared/api.js";
import { disagreementMode, findDisagreements, RULES, type DisagreementInput, type DisagreementsView } from "../../src/shared/disagreements.js";

const built = new WeakMap<EventDetail, Promise<DisagreementsView>>();

export async function eventDisagreements(season: number, code: string): Promise<DisagreementsView | null> {
  const d = await cachedEventDetail(season, code);
  if (!d) return null;
  let v = built.get(d);
  if (!v) {
    v = build(d);
    built.set(d, v);
    v.catch(() => built.delete(d));
  }
  return v;
}

const rating = (rt: { auto: number; teleop: number; endgame: number; uncertainty: number; n: number }) =>
  ({ np: rt.auto + rt.teleop + rt.endgame, sd: Math.sqrt(Math.max(0, rt.uncertainty)), matches: rt.n });

async function build(d: EventDetail): Promise<DisagreementsView> {
  const e = d.event;
  const finished = e.status === "finished";
  if (isLegacy(e.season)) {
    return { season: e.season, code: e.code, mode: "final", ratingsAsOf: "now", compared: 0, fieldSize: d.field.length, hidden: "Seasons before 2023–24 are shown for history, without model ratings.", rows: [], rules: { ...RULES, minGap: RULES.minGapPlaces } };
  }
  const field: DisagreementInput[] = d.field.map((f) => ({
    team: f.team, name: f.name, rank: f.rank, qualPlayed: f.qualPlayed, wins: f.wins, losses: f.losses, ties: f.ties, rp: f.rp,
    opr: f.opr.np, seasonOpr: f.seasonOpr ?? null, rating: f.rating ? { np: f.rating.np, sd: f.rating.sd, matches: f.rating.matches } : null, prior: null,
  }));
  const mode = disagreementMode(field, finished);
  const opts = { season: e.season, code: e.code, finished, ratingsAsOf: "now" as const };
  if (mode === "final") return finalView(d, field);
  if (mode !== "pre-quals" || finished || !e.start || field.length < RULES.minTeams) return findDisagreements(field, opts);
  // Before seeding here: each team's seed at its most recent earlier event this season.
  const prior = await priorSeeds(e.season, e.code, e.start, field.map((f) => f.team));
  return findDisagreements(field.map((f) => ({ ...f, prior: prior.get(f.team) ?? null })), opts);
}

/** A finished event: the ratings replayed to its last match, so a team's later events don't leak into a comparison with the seeding it had then. */
async function finalView(d: EventDetail, field: DisagreementInput[]): Promise<DisagreementsView> {
  const e = d.event;
  const opts = { season: e.season, code: e.code, finished: true };
  const times = d.matches.filter((m) => m.played && m.time).map((m) => Date.parse(m.time!)).filter(Number.isFinite);
  const lastPlayed = times.length ? Math.max(...times) : NaN;
  if (!Number.isFinite(lastPlayed) || field.length < RULES.minTeams) return findDisagreements(field, { ...opts, ratingsAsOf: "now" });
  const fp = fingerprint(d, lastPlayed);
  const key = `disagreements:${e.season}:${e.code}`;
  const kept = await kvGet<{ fp: string; view: DisagreementsView }>(key).catch(() => null);
  if (kept?.fp === fp) return kept.view;
  const f = await liveForecaster(e.season).catch(() => null);
  if (!f) return findDisagreements(field, { ...opts, ratingsAsOf: "now" });
  const at = new Map<number, NonNullable<DisagreementInput["rating"]>>();
  f.replayTo(e.season, [lastPlayed + 1], (_ms, book) => {
    for (const x of field) if (book.ratings.has(x.team)) at.set(x.team, rating(book.get(x.team)));
  });
  const view = findDisagreements(field.map((x) => ({ ...x, rating: at.get(x.team) ?? null })), { ...opts, ratingsAsOf: "event-end" });
  await kvSet(key, { fp, view }).catch(() => {}); // a read-only database still answers, just without keeping it
  return view;
}

/** Bump when the stored view's shape or the rules change, so kept answers are rebuilt. */
const FORMAT = 1;

/** What a finished event's comparison is built from: the engine, its last match, and its seeding, records and OPR. */
export function fingerprint(d: Pick<EventDetail, "field" | "matches">, lastPlayed: number): string {
  const s = d.field.map((f) => `${f.team}:${f.rank ?? ""}:${f.qualPlayed ?? ""}:${f.wins ?? ""}-${f.losses ?? ""}-${f.ties ?? ""}:${f.rp ?? ""}:${f.opr.np ?? ""}`).join(",");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${ENGINE_VERSION}|${FORMAT}|${lastPlayed}|${d.matches.filter((m) => m.played).length}|${(h >>> 0).toString(36)}`;
}

/** Each team's seed at its latest event this season that ended before `start` (with a real field and enough matches). */
export async function priorSeeds(season: number, code: string, start: string, teams: number[]): Promise<Map<number, NonNullable<DisagreementInput["prior"]>>> {
  if (!teams.length) return new Map();
  const rows = await all<any>(
    `SELECT et.team, et.rank, e.code, e.name, e.end, sz.n
       FROM event_teams et
       JOIN events e ON e.season = et.season AND e.code = et.code
       JOIN (SELECT code, COUNT(*) n FROM event_teams WHERE season = ? AND rank IS NOT NULL GROUP BY code) sz ON sz.code = et.code
      WHERE et.season = ? AND et.code != ? AND e.end < ? AND et.rank IS NOT NULL AND et.qual_played >= ? AND sz.n >= ?
        AND et.team IN (${teams.map(() => "?").join(",")})
      ORDER BY e.end DESC, e.start DESC, e.code`,
    [season, season, code, start, RULES.minPriorPlayed, RULES.minPriorField, ...teams],
  );
  const out = new Map<number, NonNullable<DisagreementInput["prior"]>>();
  for (const r of rows) {
    const t = Number(r.team);
    if (!out.has(t)) out.set(t, { rank: Number(r.rank), of: Number(r.n), code: String(r.code), name: String(r.name) });
  }
  return out;
}
