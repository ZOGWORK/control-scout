// Event details for the "At a glance" tests: upcoming (field, no schedule), live (part played, live and
// backtest calls), finished (alliances, awards, advancement) and remote (one team per match).
import type { EventDetail, FieldRow, MatchView } from "../shared/api";

type Score = NonNullable<MatchView["red"]["score"]>;
const sc = (total: number, pen = 0, parts: Partial<Score> = {}): Score => ({ total, np: total - pen, auto: 0, teleop: 0, endgame: 0, pen, ...parts });
const side = (teams: number[], score: Score | null) => ({ teams: teams.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score });

export function m(n: number, red: number[], blue: number[], o: { red?: Score | null; blue?: Score | null; level?: "qual" | "playoff"; pRed?: number; kind?: "live" | "backtest" | "now"; startsAt?: string; code?: string } = {}): MatchView {
  const level = o.level ?? "qual";
  const played = o.red != null || o.blue != null;
  return {
    season: 2025, code: o.code ?? "TEST", key: `${level}:${level === "qual" ? 0 : 1}:${n}`, level, series: level === "qual" ? 0 : 1, number: n,
    label: `${level === "qual" ? "Q" : "F"}${n}`, time: null, startsAt: o.startsAt ?? null, played,
    red: side(red, o.red ?? null), blue: side(blue, o.blue ?? null), video: null,
    prediction: o.pRed == null ? null : { pRed: o.pRed, redMean: 100, blueMean: 100, tier: "moderate", kind: o.kind ?? (played ? "backtest" : "now"), predictedAt: null },
  };
}

export function row(team: number, o: Partial<FieldRow> = {}): FieldRow {
  return {
    team, name: `Team ${team}`, city: null, state: null, rank: null, rp: null, tbp: null, wins: null, losses: null, ties: null, qualPlayed: null,
    opr: { np: null, auto: null, teleop: null, endgame: null, pen: null }, avgNp: null, rating: null, ...o,
  };
}

export function detail(o: { status: EventDetail["event"]["status"]; field?: FieldRow[]; matches?: MatchView[]; remote?: boolean } & Partial<Omit<EventDetail, "event">>): EventDetail {
  const { status, remote, field = [], matches = [], ...rest } = o;
  return {
    event: {
      season: 2025, code: "TEST", name: "Test Event", type: "Qualifier", typeLabel: "Qualifier", divisionCode: null, region: null, city: null, state: null, country: null,
      venue: null, start: "2026-03-14", end: "2026-03-15", remote: !!remote, teams: field.length, matchesPlayed: matches.filter((x) => x.played).length, matchesTotal: matches.length,
      status, website: null, livestream: null, timezone: null, source: "first",
    },
    field, matches, alliances: [], awards: [], advancement: null, forecastUnsupported: null, live: null, ...rest,
  };
}

export const upcoming = () => detail({
  status: "upcoming",
  field: [
    row(100, { rating: { np: 80, sd: 10, matches: 6 }, seasonOpr: 70 }),
    row(200, { rating: { np: 120, sd: 9, matches: 8 }, seasonOpr: 110 }),
    row(300, { rating: { np: 95, sd: 12, matches: 4 }, seasonOpr: null }),
    row(400, { rating: { np: 60, sd: 15, matches: 2 }, seasonOpr: 50 }),
    row(500),
  ],
});

export const live = () => detail({
  status: "live",
  live: { checkedAt: null, everySeconds: 60, auto: true },
  field: [
    row(1, { rank: 1, opr: { np: 90, auto: 20, teleop: 50, endgame: 20, pen: 3 } }),
    row(2, { rank: 2, opr: { np: 80, auto: 30, teleop: 40, endgame: 10, pen: 2 } }),
    row(3, { opr: { np: 70, auto: 10, teleop: 45, endgame: 25, pen: 1 } }),
    row(4, { opr: { np: 60, auto: 5, teleop: 35, endgame: 15, pen: 4 } }),
  ],
  matches: [
    // red 120 (10 pen given by blue), blue 100: favourite red won (live call).
    m(1, [1, 2], [3, 4], { red: sc(120, 10), blue: sc(100, 6), pRed: 0.7, kind: "live" }),
    // upset in a live call: red 80% favourite, blue won 150-90.
    m(2, [1, 3], [2, 4], { red: sc(90, 0), blue: sc(150, 4), pRed: 0.8, kind: "live" }),
    // backtest call, blue favourite, blue won by 2 (the closest).
    m(3, [1, 4], [2, 3], { red: sc(98, 2), blue: sc(100, 0), pRed: 0.4, kind: "backtest" }),
    m(4, [2, 3], [1, 4], { pRed: 0.55, startsAt: "2026-03-14T15:30:00Z" }),
    m(5, [1, 2], [3, 4], { pRed: 0.6, startsAt: "2026-03-14T15:40:00Z" }),
  ],
});

export const finished = () => detail({
  status: "finished",
  field: [
    row(1, { rank: 1, opr: { np: 90, auto: 20, teleop: 50, endgame: 20, pen: 3 } }),
    row(2, { rank: 2, opr: { np: 80, auto: 30, teleop: 40, endgame: 10, pen: 2 } }),
    row(3, { rank: 3, opr: { np: 70, auto: 10, teleop: 45, endgame: 25, pen: 1 } }),
    row(4, { rank: 4, opr: { np: 60, auto: 5, teleop: 35, endgame: 15, pen: 4 } }),
  ],
  matches: [
    m(1, [1, 2], [3, 4], { red: sc(120), blue: sc(100), pRed: 0.6 }),
    m(2, [1, 3], [2, 4], { red: sc(110), blue: sc(110), pRed: 0.5 }),
    m(1, [1, 3], [2, 4], { red: sc(200, 20), blue: sc(140), level: "playoff", pRed: 0.6 }),
  ],
  alliances: [{ number: 1, name: null, captain: 1, pick1: 3, pick2: null, backup: null }, { number: 2, name: null, captain: 2, pick1: 4, pick2: null, backup: null }],
  awards: [
    { type: "Inspire", placement: 1, team: 2, name: "Inspire Award" },
    { type: "Inspire", placement: 2, team: 4, name: "Inspire Award" },
    { type: "Winner", placement: 1, team: 3, name: null },
    { type: "Winner", placement: 1, team: 1, name: null },
  ],
  advancement: { slots: 3, advancesTo: "State Championship", rows: [] },
});

/** A remote event: each match is one team on red, no opponent. */
export const remote = () => detail({
  status: "finished", remote: true,
  field: [row(7), row(8)],
  matches: [m(1, [7], [], { red: sc(60, 5) }), m(2, [8], [], { red: sc(85) }), m(3, [7], [], { red: sc(70) })],
});
