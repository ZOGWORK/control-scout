// A team's predicted rank against its actual rank at every event of a season ("12345 predicted vs actual rank at every
// event this season"). No rank forecast is kept for a finished event, so the predicted rank is read from the engine's
// own stored pre-match calls (the predictions ledger, as the "Prediction vs result" card reads it): each ranked team's
// expected qualification wins (its win chances summed over the event's qualification matches with a call), teams
// ordered by them. The actual rank is the event's official ranking. One kind of call per event: logged live when the
// live log covers every qualification match played, else the walk-forward replay, said which; never the two mixed.
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all } from "../../db.js";
import { eventHref, shortEvent } from "../answers/matchSet.js";

interface Ev { code: string; name: string; type: string | null; start: string | null; rank: number }
interface Call { code: string; level: string; series: number; number: number; red: string; blue: string; p_red: number; kind: string }

const lineup = (side: string): number[] => { try { const v = JSON.parse(side); return Array.isArray(v) ? v.map(Number) : []; } catch { return side.split(",").map(Number); } };

/** The card for `team` in `season`; `why` says how the season was picked when none was named. */
export async function rankReviewAnswer(team: { number: number; name: string | null }, season: number, why?: string): Promise<StatAnswer> {
  const S = seasonLabel(season), who = `${team.name ?? `Team ${team.number}`} (${team.number})`;
  const evs = await all<Ev>(`SELECT e.code, e.name, e.type, e.start, t.rank FROM event_teams t JOIN events e ON e.season = t.season AND e.code = t.code
    WHERE t.season = ? AND t.team = ? AND t.rank IS NOT NULL ORDER BY e.start, e.code`, [season, team.number]);
  const base: Omit<StatAnswer, "blocks"> = {
    family: "stat", intent: "predicted-vs-actual-rank", title: `Predicted vs actual rank, event by event`, team, scope: [S, "Every event ranked"],
    definition: `Predicted rank: no rank forecast is kept for a finished event, so it is read from the engine's stored pre-match calls. Each ranked team's expected qualification wins (its win chances summed over the event's qualification matches) put the event's teams in order; teams with the same expected wins share a rank. One kind of call per event: logged live before each match when the live log covers every qualification match played, else the walk-forward replay. Actual rank: the event's official ranking.${why ? ` ${why}` : ""}`,
    source: `${evs.length} ranked event${evs.length === 1 ? "" : "s"} in ${S}`,
  };
  if (!evs.length) return { ...base, blocks: [], none: `${who} has no ranked events in ${S}.` };
  const codes = evs.map((e) => e.code), marks = codes.map(() => "?").join(", ");
  const [calls, played, ranked] = await Promise.all([
    all<Call>(`SELECT p.code, p.level, p.series, p.number, p.red, p.blue, p.p_red, p.kind FROM predictions p JOIN matches m
      ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
      WHERE p.season = ? AND p.code IN (${marks}) AND p.level = 'qual' AND m.played = 1`, [season, ...codes]),
    all<{ code: string; n: number }>(`SELECT code, COUNT(*) n FROM matches WHERE season = ? AND code IN (${marks}) AND level = 'qual' AND played = 1 GROUP BY code`, [season, ...codes]),
    all<{ code: string; team: number }>(`SELECT code, team FROM event_teams WHERE season = ? AND code IN (${marks}) AND rank IS NOT NULL`, [season, ...codes]),
  ]);
  const playedAt = new Map(played.map((r) => [r.code, Number(r.n)]));
  const kinds = new Set<string>();
  const rows = evs.map((ev) => {
    const here = calls.filter((c) => c.code === ev.code);
    const live = new Set(here.filter((c) => c.kind === "live").map((c) => `${c.series}|${c.number}`));
    const kind = live.size && live.size >= (playedAt.get(ev.code) ?? 0) ? "live" : "backtest";
    const mine = here.filter((c) => c.kind === kind);
    const field = ranked.filter((r) => r.code === ev.code).map((r) => Number(r.team));
    const expected = new Map(field.map((t) => [t, 0]));
    for (const c of mine) {
      for (const t of lineup(c.red)) if (expected.has(t)) expected.set(t, expected.get(t)! + Number(c.p_red));
      for (const t of lineup(c.blue)) if (expected.has(t)) expected.set(t, expected.get(t)! + 1 - Number(c.p_red));
    }
    const own = expected.get(team.number);
    const called = mine.some((c) => lineup(c.red).includes(team.number) || lineup(c.blue).includes(team.number));
    const predicted = called && own != null ? 1 + [...expected.values()].filter((v) => v > own + 1e-9).length : null;
    if (predicted != null) kinds.add(kind);
    const gap = predicted == null ? null : Number(ev.rank) - predicted;
    return {
      gap, predicted,
      row: {
        cells: {
          event: shortEvent(ev.name, ev.type),
          predicted: predicted == null ? "No calls stored" : `#${predicted} of ${field.length}`,
          expected: own == null || !called ? "–" : own.toFixed(1),
          actual: `#${ev.rank}`,
          gap: gap == null ? "–" : gap === 0 ? "On the mark" : gap < 0 ? `${-gap} better` : `${gap} worse`,
        },
        href: eventHref(season, ev.code, team.number),
      },
    };
  });
  const judged = rows.filter((r) => r.gap != null);
  const label = kinds.size === 1 ? ([...kinds][0] === "live" ? "logged live before each match" : "walk-forward replay (not logged live)") : kinds.size ? "live where logged, else the replay, per event" : "";
  const table: StatBlock = {
    kind: "table", title: "Predicted and actual rank, side by side",
    columns: [{ key: "event", label: "Event" }, { key: "predicted", label: "Predicted" }, { key: "expected", label: "Exp. wins" }, { key: "actual", label: "Actual" }, { key: "gap", label: "Finish vs call" }],
    rows: rows.map((r) => r.row),
  };
  if (!judged.length) return { ...base, blocks: [table], none: `No pre-match calls are stored for ${who}'s ${S} events, so there is no predicted rank to set beside the actual one.` };
  const avg = judged.reduce((n, r) => n + Math.abs(r.gap!), 0) / judged.length;
  const onMark = judged.filter((r) => r.gap === 0).length;
  return {
    ...base, blocks: [table],
    headline: { value: `${avg.toFixed(1)} places`, label: `average gap between predicted and actual rank over ${judged.length} event${judged.length === 1 ? "" : "s"} (${onMark} on the mark)`, sub: [S, label].filter(Boolean).join(" · ") },
  };
}
