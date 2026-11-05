// A team's forecast at one named event, before and after (docs/search-pipeline.md, "Prediction"): what the engine
// predicted before each match (the predictions ledger: live, logged before the match, or else the walk-forward replay,
// never the two blended) and the stored pre-event projection, beside what happened. An event still to come shows the
// forecast only. Every number is stored; nothing is worked out for the search.
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import { dateRange, seasonLabel } from "../../../src/shared/format.js";
import { predictHref } from "../../../src/shared/predictUrl.js";
import { isLegacy } from "../../data/seasons.js";
import { ROSTER } from "../../data/registrations.js";
import { all, get } from "../../db.js";
import { search } from "../search.js";
import { isEnabled } from "../../flags.js";
import { eventFit } from "../answers/index.js";
import { eventHref, matchHref, shortEvent } from "../answers/matchSet.js";
import { nextEventPrediction } from "../answers/families/predict.js";
import { readProjections } from "../../projections/store.js";
import { readyForecaster, recentRecords } from "../../predict/engine.js";
import { plusMinus } from "../../../src/shared/scoreRange.js";
import { EVENT_FIT } from "./context.js";

interface Ev { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null }
const pct = (p: number) => `${Math.round(100 * p)}%`;

/** The event's stored pre-event projection for a team, only while event forecasts are switched on (as on the event page). */
async function projectionOf(ev: Ev, team: number) {
  const odds = await isEnabled("advancementOdds").catch(() => false);
  const run = odds ? (await readProjections(Number(ev.season), ev.code).catch(() => null))?.baseline : undefined;
  return run?.teams.find((t) => t.team === team);
}

/** A match's call as the engine makes it now, with its score ranges, the team's side first ("Predicted 138 ±14 –
 *  92 ±12"), as the match page makes it (its event's form in): a stored call keeps no range. Null when live
 *  predictions are off, the engine isn't built yet, or the season has no rated match (the match page shows no score
 *  then either: the ratings are carried over from the last game). */
async function rangedCall(season: number, code: string, red: number[], blue: number[], level: string, own: "red" | "blue"): Promise<string | null> {
  if (!(await isEnabled("livePredictions").catch(() => false))) return null;
  const p = readyForecaster(season);
  if (!p) return null;
  const f = await p;
  if (!f.seasonEvents(season).length) return null;
  const x = f.explain(season, red, blue, level === "playoff" ? "playoff" : "qual", code, await recentRecords(season, [...red, ...blue]));
  if (!x) return null;
  const [mo, ro, mp, rp] = own === "red" ? [x.predictedScoreA, x.scoreRangeA, x.predictedScoreB, x.scoreRangeB] : [x.predictedScoreB, x.scoreRangeB, x.predictedScoreA, x.scoreRangeA];
  return `Predicted ${Math.round(mo)} ±${plusMinus(mo, ro)} – ${Math.round(mp)} ±${plusMinus(mp, rp)}, the engine's call with its 80% ranges`;
}

/** The event the words name for these teams: the year asked (held that year), else the latest one they're listed at,
 *  else the latest of that name (and the answer says they aren't listed). Null when no event has that name. */
export async function eventFor(words: string, teams: number[], year: number | null): Promise<{ ev: Ev; listed: boolean } | null> {
  const hits = (await search(words, 25, new Set(), new Set(["event"]))).filter((h) => h.kind === "event" && eventFit(words, h.title, h.ref.split(":")[1] ?? "") >= EVENT_FIT);
  if (!hits.length) return null;
  // Every season of each event named (a code is reused year to year), by name.
  const codes = [...new Set(hits.map((h) => h.ref.split(":")[1]))];
  const rows = await all<Ev>(`SELECT season, code, name, type, start, end FROM events WHERE code IN (${codes.map(() => "?").join(", ")}) ORDER BY start DESC`, codes);
  const named = rows.filter((e) => eventFit(words, e.name, e.code) >= EVENT_FIT && (year == null || (e.start ?? "").startsWith(String(year))));
  if (!named.length) return null;
  const listed = await all<{ season: number; code: string }>(`SELECT DISTINCT season, code FROM ${ROSTER} r WHERE team IN (${teams.map(() => "?").join(", ")}) AND (${named.map(() => "(season = ? AND code = ?)").join(" OR ")})`,
    [...teams, ...named.flatMap((e) => [e.season, e.code])]);
  const theirs = named.filter((e) => listed.some((l) => Number(l.season) === Number(e.season) && l.code === e.code));
  return theirs.length ? { ev: theirs[0], listed: true } : { ev: named[0], listed: false };
}

interface Pred { code: string; level: string; series: number; number: number; red: string; blue: string; p_red: number; red_mean: number; blue_mean: number; no_score_basis: number | null; red_score: number | null; blue_score: number | null; played: number; kind: string; label: string | null }

/** Whether `team` won the event: on the winning side of its last playoff match (the final), at the event itself, not a
 *  division. With no playoff on record, the event's Winning Alliance award (a Leadership Award is filed as a "Winner"
 *  too, so never that). */
async function wonEvent(season: number, code: string, team: number): Promise<boolean> {
  const f = await get<{ alliance: string; red_total: number; blue_total: number }>(
    `SELECT x.alliance, m.red_total, m.blue_total FROM matches m JOIN match_teams x ON x.season = m.season AND x.code = m.code AND x.level = m.level AND x.series = m.series AND x.number = m.number AND x.team = ?
     WHERE m.season = ? AND m.code = ? AND m.level = 'playoff' AND m.played = 1 AND m.red_total IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM matches l WHERE l.season = m.season AND l.code = m.code AND l.level = 'playoff' AND l.played = 1 AND (l.series > m.series OR (l.series = m.series AND l.number > m.number)))`, [team, season, code]);
  if (f) return f.alliance === "red" ? f.red_total > f.blue_total : f.blue_total > f.red_total;
  const final = await get("SELECT 1 FROM matches WHERE season = ? AND code = ? AND level = 'playoff' AND played = 1 LIMIT 1", [season, code]);
  if (final) return false;
  return !!(await get("SELECT 1 FROM awards WHERE season = ? AND code = ? AND team = ? AND type = 'Winner' AND COALESCE(name, '') NOT LIKE '%eadership%' LIMIT 1", [season, code, team]));
}

/** Before and after at `ev` for `teams` (one team, or two teams' meetings). */
export async function forecastAt(teams: { number: number; name: string | null }[], ev: Ev, listed: boolean, now: number): Promise<StatAnswer> {
  const who = (t: { number: number; name: string | null }) => `${t.name ?? `Team ${t.number}`} (${t.number})`;
  const S = seasonLabel(Number(ev.season)), name = shortEvent(ev.name, ev.type), when = dateRange(ev.start, ev.end);
  const [a, b] = teams;
  const title = b ? `Prediction vs result: ${a.number} and ${b.number} at ${name}` : `Prediction vs result at ${name}`;
  const predict = b
    ? { label: `Open in Predict: ${a.number} vs ${b.number}`, href: predictHref({ mode: "match", season: Number(ev.season), red: [a.number], blue: [b.number] }) }
    : { label: `Open in Predict: ${a.number} at ${name}`, href: predictHref({ mode: "advancement", season: Number(ev.season), code: ev.code, team: a.number }) };
  const links: StatBlock = { kind: "links", title: "Open", items: [predict, { label: name, sub: when, href: eventHref(Number(ev.season), ev.code, a.number) }] };
  // Predict printed once: as the chance's action when the card has one ("Open in Predict", short enough for a phone's
  // button), else in the links.
  const act = { label: "Open in Predict", href: predict.href };
  const withoutPredict: StatBlock = { ...links, items: links.items.filter((l) => l !== predict) };
  const base: Omit<StatAnswer, "blocks"> = {
    family: b ? "two-team" : "stat", intent: b ? "pipeline-two-predict-event" : "pipeline-team-predict-event", title, team: a, ...(b ? { teams } : {}),
    scope: [name, S], definition: "Before: the engine's prediction logged before each match (live), or, for matches it didn't log live, its walk-forward replay of the same match, said which; the two are never mixed on one card. The pre-event projection is the forecast stored before the event's first match. A stored call keeps its predicted score but not its range; a match still to come shows the engine's call now with its 80% ranges. After: the official result.",
    source: `${ev.name}, ${S}${when ? ` · ${when}` : ""}`,
  };
  if (!listed) return { ...base, blocks: [links], none: `${teams.map(who).join(" and ")} ${b ? "aren't" : "isn't"} listed at ${ev.name} (${S}), the latest event by that name, so there's no prediction for ${b ? "them" : "it"} there.` };
  if (isLegacy(Number(ev.season))) return { ...base, blocks: [links], none: `Predictions start with 2023–24: ${S} has none to compare.` };
  const upcoming = (ev.end ?? ev.start ?? "") >= new Date(now).toISOString().slice(0, 10);
  const played = await get<{ n: number }>("SELECT COUNT(*) n FROM matches WHERE season = ? AND (code = ? OR code IN (SELECT code FROM events WHERE season = ? AND division_code = ?)) AND played = 1", [ev.season, ev.code, ev.season, ev.code]);
  // Still to come (or not started): the forecast the event page shows, with Predict open on it.
  if (upcoming && !Number(played?.n) && !b) {
    const f = await nextEventPrediction("event-win-chance", a, new Date(now), { season: Number(ev.season), code: ev.code }, Number(ev.season));
    // The chance to win it on its 0–100% bar, with Predict as the card's one action.
    const pre = await projectionOf(ev, a.number);
    const chance: StatBlock | null = pre ? { kind: "chance", p: pre.pWin, who: String(a.number), label: "to win the event, before it starts", action: act } : null;
    return { ...once({ ...f, blocks: [...(chance ? [chance] : []), ...f.blocks.filter((x) => x.kind !== "links"), chance ? withoutPredict : links] }), title, intent: base.intent, scope: [...f.scope, "Not played yet"], definition: `${f.definition} After: the event hasn't been played yet, so there's no result to set beside it.` };
  }
  // The matches: the team's (or both teams'), qualifications and playoffs, at the event and its divisions; one still to
  // be played shows its saved call with no result yet.
  const rows = await all<Pred>(`SELECT p.code, p.kind, p.level, p.series, p.number, p.red, p.blue, p.p_red, p.red_mean, p.blue_mean, p.no_score_basis,
      m.red_total red_score, m.blue_total blue_score, m.played, m.label
    FROM predictions p JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
    WHERE p.season = ? AND (p.code = ? OR p.code IN (SELECT code FROM events WHERE season = ? AND division_code = ?))
    ORDER BY m.played DESC, m.time, p.level DESC, p.series, p.number`, [ev.season, ev.code, ev.season, ev.code]);
  // A lineup is stored as a JSON list of team numbers ("[12345,67890]").
  const lineup = (side: string): number[] => { try { const v = JSON.parse(side); return Array.isArray(v) ? v.map(Number) : []; } catch { return side.split(",").map(Number); } };
  const has = (side: string, n: number) => lineup(side).includes(n);
  const mine = rows.filter((r) => teams.every((t) => has(r.red, t.number) || has(r.blue, t.number)));
  // One kind per card: live when any match was logged live, else the replay.
  const kind = mine.some((r) => r.kind === "live") ? "live" : "backtest";
  const ms = mine.filter((r) => r.kind === kind);
  const pre = await projectionOf(ev, a.number);
  const rank = await get<{ rank: number | null }>("SELECT rank FROM event_teams WHERE season = ? AND team = ? AND (code = ? OR code IN (SELECT code FROM events WHERE season = ? AND division_code = ?)) AND rank IS NOT NULL ORDER BY rank LIMIT 1", [ev.season, a.number, ev.code, ev.season, ev.code]);
  const won = await wonEvent(Number(ev.season), ev.code, a.number);
  // Two teams: only their meetings are the answer (one team's odds to win the event never stand in for them).
  if (!ms.length && (b || !pre)) return { ...base, blocks: [links], none: `No prediction was stored for ${teams.map(who).join(" and ")}${b ? " meeting" : ""} at ${ev.name} (${S}).` };
  // The team's side in each match: its predicted win chance and score, and what happened.
  const side = (r: Pred) => (has(r.red, a.number) ? "red" : "blue");
  const table = ms.map((r) => {
    const s = side(r), pWin = s === "red" ? r.p_red : 1 - r.p_red;
    const own = Number(r.played) ? (s === "red" ? r.red_score : r.blue_score) : null, opp = Number(r.played) ? (s === "red" ? r.blue_score : r.red_score) : null;
    const predOwn = Math.round(s === "red" ? r.red_mean : r.blue_mean), predOpp = Math.round(s === "red" ? r.blue_mean : r.red_mean);
    const result = own == null || opp == null ? "–" : own > opp ? "W" : own < opp ? "L" : "T";
    const partners = b ? (has(r.red, b.number) === has(r.red, a.number) ? "partners" : "opponents") : null;
    return { pWin, result, played: !!Number(r.played), row: { cells: { match: r.label ?? `${r.level === "qual" ? "Q" : "M"}${r.number}`, ...(partners ? { as: partners } : {}), before: Number(r.no_score_basis) ? pct(pWin) : `${pct(pWin)} · ${predOwn}–${predOpp}`, after: !Number(r.played) ? "Not played yet" : own == null ? "–" : `${result} ${own}–${opp}`, called: result === "–" || result === "T" ? "–" : (pWin >= 0.5) === (result === "W") ? "Yes" : "No" }, href: matchHref({ season: Number(ev.season), code: r.code, level: r.level, series: r.series, number: r.number }) } };
  });
  // Expected and actual wins over the matches played; one still to come shows its call alone.
  const done = table.filter((r) => r.played), next = table.find((r) => !r.played);
  const expWins = done.reduce((n, r) => n + r.pWin, 0), wins = table.filter((r) => r.result === "W").length, losses = table.filter((r) => r.result === "L").length, ties = table.filter((r) => r.result === "T").length;
  const called = table.filter((r) => r.row.cells.called === "Yes").length, decided = table.filter((r) => r.row.cells.called !== "–").length;
  // The chance on its 0–100% bar: the next match's, else the average over the matches played, else the event's.
  const nextRow = next ? ms[table.indexOf(next)] : undefined;
  const note = nextRow ? await rangedCall(Number(ev.season), nextRow.code, lineup(nextRow.red), lineup(nextRow.blue), nextRow.level, side(nextRow)).catch(() => null) : null;
  const chance: StatBlock | null = next ? { kind: "chance", p: next.pWin, who: String(a.number), label: `to win ${b ? "their next meeting" : "the next match"} (${next.row.cells.match}), before it's played`, ...(note ? { note } : {}), action: act }
    : done.length ? { kind: "chance", p: expWins / done.length, who: String(a.number), label: `average chance to win each ${b ? "meeting" : "match"}, before it was played`, action: act }
    : pre ? { kind: "chance", p: pre.pWin, who: String(a.number), label: "to win the event, before it started", action: act } : null;
  const label = kind === "live" ? "logged live before each match" : "walk-forward replay (not logged live)";
  // Two teams always on the same footing (all partners, or all opponents) say so in the title, not a column.
  const sides = new Set(table.map((r) => r.row.cells.as));
  const asColumn = !!b && sides.size > 1;
  const asTitle = b && sides.size === 1 ? `, as ${[...sides][0]}` : "";
  if (!asColumn) for (const r of table) delete r.row.cells.as;
  const blocks: StatBlock[] = [
    ...(chance ? [chance] : []),
    { kind: "kpis", items: [
      // Expected wins are the headline's once any match is played: printed once.
      ...(done.length ? [] : [{ label: "Before: expected wins", value: "–", sub: ms.length ? "None played yet" : "No match predictions stored" }]),
      { label: "After: record", value: done.length ? `${wins}-${losses}-${ties}` : "–", sub: rank?.rank != null ? `Ranked #${rank.rank}` : undefined },
      ...(pre ? [{ label: "Before: projected rank", value: pre.rank ? `#${Math.round(pre.rank.p50)}` : "–", sub: `Win the event ${pct(pre.pWin)} · playoffs ${pct(pre.pPlayoff)}` }] : []),
      { label: "After: event", value: won ? "Won" : rank?.rank != null ? `#${rank.rank}` : "–", ...(won ? { tone: "good" as const } : {}) },
      ...(decided ? [{ label: "Called right", value: `${called} of ${decided}`, sub: pct(called / decided) }] : []),
    ] },
    ...(ms.length ? [{ kind: "table" as const, title: `Before (win chance · predicted score) and after, match by match${asTitle}`, columns: [{ key: "match", label: "Match" }, ...(asColumn ? [{ key: "as", label: "As" }] : []), { key: "before", label: "Before" }, { key: "after", label: "After" }, { key: "called", label: "Right" }], rows: table.map((r) => r.row) }] : []),
    chance ? withoutPredict : links,
  ];
  return once({
    ...base, blocks,
    headline: done.length
      ? { value: `${expWins.toFixed(1)} → ${wins} wins`, label: `expected before, won after${b ? `, in their ${done.length} meeting${done.length === 1 ? "" : "s"}` : ""}`, sub: [S, when, label].filter(Boolean).join(" · "), href: predict.href }
      : next
        ? { value: pct(next.pWin), label: `to win ${b ? "their next meeting" : "the next match"} (${next.row.cells.match}), not played yet`, sub: [S, when, label].filter(Boolean).join(" · "), href: predict.href }
        : { value: pre ? pct(pre.pWin) : "–", label: "to win the event, before it started", sub: [S, when].filter(Boolean).join(" · "), href: predict.href },
  });
}

/** The chance printed once (the results guide, §7): with a chance bar, a headline or a tile of the same percentage
 *  goes, its details kept under the bar. */
function once(a: StatAnswer): StatAnswer {
  const c = a.blocks.find((x): x is Extract<StatBlock, { kind: "chance" }> => x.kind === "chance");
  if (!c) return a;
  const same = pct(c.p);
  const head = a.headline?.value === same ? a.headline : undefined;
  const note = [head?.sub, c.note].filter(Boolean).join(" · ");
  const blocks = a.blocks.map((x) => (x === c ? { ...c, ...(note ? { note } : {}) }
    : x.kind === "kpis" ? { ...x, items: x.items.filter((i) => i.value !== same) } : x)).filter((x) => x.kind !== "kpis" || x.items.length);
  return { ...a, blocks, ...(head ? { headline: undefined } : {}) };
}

