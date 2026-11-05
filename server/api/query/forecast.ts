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
import { eventFit } from "../answers/index.js";
import { eventHref, matchHref, shortEvent } from "../answers/matchSet.js";
import { nextEventPrediction } from "../answers/families/predict.js";
import { readProjections } from "../../projections/store.js";
import { EVENT_FIT } from "./context.js";

interface Ev { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null }
const pct = (p: number) => `${Math.round(100 * p)}%`;

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

interface Pred { level: string; series: number; number: number; red: string; blue: string; p_red: number; red_mean: number; blue_mean: number; red_score: number | null; blue_score: number | null; kind: string; label: string | null }

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
  const base: Omit<StatAnswer, "blocks"> = {
    family: b ? "two-team" : "stat", intent: b ? "pipeline-two-predict-event" : "pipeline-team-predict-event", title, team: a, ...(b ? { teams } : {}),
    scope: [name, S], definition: "Before: the engine's prediction logged before each match (live), or, for matches it didn't log live, its walk-forward replay of the same match, said which; the two are never mixed on one card. The pre-event projection is the forecast stored before the event's first match. After: the official result.",
    source: `${ev.name}, ${S}${when ? ` · ${when}` : ""}`,
  };
  if (!listed) return { ...base, blocks: [links], none: `${teams.map(who).join(" and ")} ${b ? "aren't" : "isn't"} listed at ${ev.name} (${S}), the latest event by that name, so there's no prediction for ${b ? "them" : "it"} there.` };
  if (isLegacy(Number(ev.season))) return { ...base, blocks: [links], none: `Predictions start with 2023–24: ${S} has none to compare.` };
  const upcoming = (ev.end ?? ev.start ?? "") >= new Date(now).toISOString().slice(0, 10);
  const played = await get<{ n: number }>("SELECT COUNT(*) n FROM matches WHERE season = ? AND (code = ? OR code IN (SELECT code FROM events WHERE season = ? AND division_code = ?)) AND played = 1", [ev.season, ev.code, ev.season, ev.code]);
  // Still to come (or not started): the forecast the event page shows, with Predict open on it.
  if (upcoming && !Number(played?.n) && !b) {
    const f = await nextEventPrediction("event-win-chance", a, new Date(now), { season: Number(ev.season), code: ev.code }, Number(ev.season));
    return { ...f, title, intent: base.intent, scope: [...f.scope, "Not played yet"], blocks: [...f.blocks.filter((x) => x.kind !== "links"), links], definition: `${f.definition} After: the event hasn't been played yet, so there's no result to set beside it.` };
  }
  // The matches: the team's (or both teams'), qualifications and playoffs, at the event and its divisions.
  const rows = await all<Pred>(`SELECT p.kind, p.level, p.series, p.number, p.red, p.blue, p.p_red, p.red_mean, p.blue_mean, m.red_total red_score, m.blue_total blue_score, m.label
    FROM predictions p JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
    WHERE p.season = ? AND (p.code = ? OR p.code IN (SELECT code FROM events WHERE season = ? AND division_code = ?)) AND m.played = 1
    ORDER BY m.time, p.level DESC, p.series, p.number`, [ev.season, ev.code, ev.season, ev.code]);
  // A lineup is stored as a JSON list of team numbers ("[4215,6980]").
  const lineup = (side: string): number[] => { try { const v = JSON.parse(side); return Array.isArray(v) ? v.map(Number) : []; } catch { return side.split(",").map(Number); } };
  const has = (side: string, n: number) => lineup(side).includes(n);
  const mine = rows.filter((r) => teams.every((t) => has(r.red, t.number) || has(r.blue, t.number)));
  // One kind per card: live when any match was logged live, else the replay.
  const kind = mine.some((r) => r.kind === "live") ? "live" : "backtest";
  const ms = mine.filter((r) => r.kind === kind);
  const run = (await readProjections(Number(ev.season), ev.code).catch(() => null))?.baseline;
  const pre = run?.teams.find((t) => t.team === a.number);
  const rank = await get<{ rank: number | null }>("SELECT rank FROM event_teams WHERE season = ? AND team = ? AND (code = ? OR code IN (SELECT code FROM events WHERE season = ? AND division_code = ?)) AND rank IS NOT NULL ORDER BY rank LIMIT 1", [ev.season, a.number, ev.code, ev.season, ev.code]);
  const won = await get("SELECT 1 FROM awards WHERE season = ? AND code = ? AND team = ? AND type = 'Winner' LIMIT 1", [ev.season, ev.code, a.number]);
  if (!ms.length && !pre) return { ...base, blocks: [links], none: `No prediction was stored for ${teams.map(who).join(" and ")}${b ? " meeting" : ""} at ${ev.name} (${S}).` };
  // The team's side in each match: its predicted win chance and score, and what happened.
  const side = (r: Pred) => (has(r.red, a.number) ? "red" : "blue");
  const table = ms.map((r) => {
    const s = side(r), pWin = s === "red" ? r.p_red : 1 - r.p_red;
    const own = s === "red" ? r.red_score : r.blue_score, opp = s === "red" ? r.blue_score : r.red_score;
    const predOwn = Math.round(s === "red" ? r.red_mean : r.blue_mean), predOpp = Math.round(s === "red" ? r.blue_mean : r.red_mean);
    const result = own == null || opp == null ? "–" : own > opp ? "W" : own < opp ? "L" : "T";
    const partners = b ? (has(r.red, b.number) === has(r.red, a.number) ? "partners" : "opponents") : null;
    return { pWin, result, row: { cells: { match: r.label ?? `${r.level === "qual" ? "Q" : "M"}${r.number}`, ...(partners ? { as: partners } : {}), before: `${pct(pWin)} · ${predOwn}–${predOpp}`, after: own == null ? "–" : `${result} ${own}–${opp}`, called: result === "–" || result === "T" ? "–" : (pWin >= 0.5) === (result === "W") ? "Yes" : "No" }, href: matchHref({ season: Number(ev.season), code: ev.code, level: r.level, series: r.series, number: r.number }) } };
  });
  const expWins = table.reduce((n, r) => n + r.pWin, 0), wins = table.filter((r) => r.result === "W").length, losses = table.filter((r) => r.result === "L").length, ties = table.filter((r) => r.result === "T").length;
  const called = table.filter((r) => r.row.cells.called === "Yes").length, decided = table.filter((r) => r.row.cells.called !== "–").length;
  const label = kind === "live" ? "logged live before each match" : "walk-forward replay (not logged live)";
  // Two teams always on the same footing (all partners, or all opponents) say so in the title, not a column.
  const sides = new Set(table.map((r) => r.row.cells.as));
  const asColumn = !!b && sides.size > 1;
  const asTitle = b && sides.size === 1 ? `, as ${[...sides][0]}` : "";
  if (!asColumn) for (const r of table) delete r.row.cells.as;
  const blocks: StatBlock[] = [
    { kind: "kpis", items: [
      { label: "Before: expected wins", value: ms.length ? expWins.toFixed(1) : "–", sub: ms.length ? `of ${ms.length} match${ms.length === 1 ? "" : "es"}, ${label}` : "No match predictions stored" },
      { label: "After: record", value: ms.length ? `${wins}-${losses}-${ties}` : "–", sub: rank?.rank != null ? `Ranked #${rank.rank}` : undefined },
      ...(pre ? [{ label: "Before: projected rank", value: pre.rank ? `#${Math.round(pre.rank.p50)}` : "–", sub: `Win the event ${pct(pre.pWin)} · playoffs ${pct(pre.pPlayoff)}` }] : []),
      { label: "After: event", value: won ? "Won" : rank?.rank != null ? `#${rank.rank}` : "–", ...(won ? { tone: "good" as const } : {}) },
      ...(decided ? [{ label: "Called right", value: `${called} of ${decided}`, sub: pct(called / decided) }] : []),
    ] },
    ...(ms.length ? [{ kind: "table" as const, title: `Before (win chance · predicted score) and after, match by match${asTitle}`, columns: [{ key: "match", label: "Match" }, ...(asColumn ? [{ key: "as", label: "As" }] : []), { key: "before", label: "Before" }, { key: "after", label: "After" }, { key: "called", label: "Right" }], rows: table.map((r) => r.row) }] : []),
    links,
  ];
  return {
    ...base, blocks,
    headline: { value: ms.length ? `${expWins.toFixed(1)} → ${wins} wins` : pre ? pct(pre.pWin) : "–", label: ms.length ? `expected before, won after${b ? `, in their ${ms.length} meeting${ms.length === 1 ? "" : "s"}` : ""}` : "to win the event, before it started", sub: [S, when, ms.length ? label : ""].filter(Boolean).join(" · "), href: predict.href },
  };
}

