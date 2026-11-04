// Families 3 and 4 over a team's events and seasons (../eventSet.ts: the team page's own precomputed rows), filtered
// by the same scope clauses as its matches (../clauses.ts):
//   best/worst finish, first/last event, best OPR event, best/first/most improved season, total events, average
//   event rank, seasons played and how many.
// The rules stated with each answer:
//   Finish: the team's qualification rank at an event (league meets left out: their rank is the league's running
//     standing, not that meet's). Best is the lowest number; on a tie the latest event.
//   Best season and most improved: by OPR rank among the season's ranked teams (as a top-percent share), since each
//     season is a different game and its OPR numbers can't be compared across seasons.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { dateRange, place, possessive, seasonLabel } from "../../../../src/shared/format.js";
import { eventInScope, scopeChips, scopePhrase, type Scope } from "../clauses.js";
import type { TeamEvent, TeamSeason } from "../eventSet.js";
import { eventHref, teamHref } from "../matchSet.js";
import type { IntentId } from "../read.js";
import { whoOf, type AnswerTeam } from "./matches.js";

const FINISH_BASE = "Finish: the team's qualification rank at the event, out of the teams ranked there. League meets are left out (their rank is the league's running standing).";
const FINISH_RULE = `${FINISH_BASE} On equal ranks, the latest event.`;
const SEASON_RULE = "Seasons are compared by OPR rank among that season's ranked teams (as the team page shows it), as a top-percent share: each season is a different game, so its OPR numbers aren't comparable across seasons.";
const EVENT_RULE = "Events the team attended (on the field at a played match, or on the roster of an event not played yet) at official events: qualifiers, league play, championships and premier events.";

const top = (s: TeamSeason) => (s.rank != null && s.of ? s.rank / s.of : null);
const topText = (s: TeamSeason) => (s.rank != null && s.of ? `#${s.rank} of ${s.of} (top ${Math.max(1, Math.round((100 * s.rank) / s.of))}%)` : "not ranked");
const rec = (s: { wins: number; losses: number; ties: number }) => `${s.wins}-${s.losses}-${s.ties}`;
const opr = (v: number | null) => (v == null ? "–" : v.toFixed(1));
const rankText = (e: TeamEvent) => (e.rank != null ? `#${e.rank}${e.of ? ` of ${e.of}` : ""}` : "–");
/** The team's record at the event as its team page shows it, or a dash. */
const evRec = (e: TeamEvent) => (e.record ? `${e.record.wins}-${e.record.losses}-${e.record.ties}` : "–");
/** Win share at the event (a tie counts half), for breaking a tie on rank. */
const evRate = (e: TeamEvent) => { const r = e.record, g = r ? r.wins + r.losses + r.ties : 0; return r && g ? (r.wins + r.ties / 2) / g : 0; };
const WORLDS_RULE = "Worlds: the FIRST Championship. One appearance per season the team attended it, shown as its division (where it ranked), with the finals noted when it played them.";

function eventRows(evs: TeamEvent[], team: number, title: string, opts: { opr?: boolean } = {}): StatBlock {
  return {
    kind: "table", title,
    columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "date", label: "Date" }, { key: "rank", label: "Rank" }, { key: "record", label: "W-L-T" }, ...(opts.opr === false ? [] : [{ key: "opr", label: "OPR", num: true }])],
    rows: evs.slice(0, 25).map((e) => ({ cells: { event: e.name, season: seasonLabel(e.season), date: dateRange(e.start, e.end), rank: rankText(e), record: evRec(e), opr: opr(e.opr) }, href: eventHref(e.season, e.code, team) })),
  };
}

function seasonRows(ss: TeamSeason[], title: string, strong?: TeamSeason): StatBlock {
  return {
    kind: "table", title,
    columns: [{ key: "season", label: "Season" }, { key: "record", label: "W-L-T" }, { key: "opr", label: "OPR", num: true }, { key: "rank", label: "OPR rank" }, { key: "events", label: "Events", num: true }],
    rows: [...ss].reverse().map((s) => ({ cells: { season: seasonLabel(s.season), record: rec(s), opr: opr(s.opr), rank: topText(s), events: s.events }, strong: s === strong })),
  };
}

/** The answer for an event or season intent, or null when `id` isn't one. */
export function eventAnswer(id: IntentId, team: AnswerTeam, set: { events: TeamEvent[]; seasons: TeamSeason[] }, scope: Scope, opts: { byRecord?: boolean } = {}): StatAnswer | null {
  const keep = eventInScope(scope);
  // Events the team has played at or that have begun: a published roster for a coming event is never its latest.
  const today = new Date().toISOString().slice(0, 10);
  const evs = set.events.filter((e) => keep(e) && (e.matches > 0 || (e.start != null && e.start.slice(0, 10) <= today)));
  const ss = set.seasons.filter((s) => (scope.season == null || s.season === scope.season) && s.matches > 0);
  const who = whoOf(team), where = scopePhrase(scope);
  const evSource = evs.length ? `From ${evs.length} event record${evs.length === 1 ? "" : "s"}, ${seasonLabel(evs[0].season)}${evs[0].season !== evs[evs.length - 1].season ? ` to ${seasonLabel(evs[evs.length - 1].season)}` : ""}` : "No events in this scope";
  const ssSource = ss.length ? `From the team's ${ss.length} season record${ss.length === 1 ? "" : "s"} (the stats the team page shows)` : "No seasons with matches";
  const base = { team, scope: scopeChips(scope) };
  const none = (what: string) => `No ${what}${where} found for ${who}.`;

  switch (id) {
    case "best-finish":
    case "worst-finish": {
      const ranked = evs.filter((e) => e.rank != null && e.type !== "LeagueMeet");
      const best = id === "best-finish";
      // "Best event": on equal ranks, the better record there (the worse for the worst), then the latest.
      const byRec = (a: TeamEvent, b: TeamEvent) => (opts.byRecord ? (best ? evRate(b) - evRate(a) : evRate(a) - evRate(b)) : 0);
      const sorted = [...ranked].sort((a, b) => (best ? a.rank! - b.rank! : b.rank! - a.rank!) || byRec(a, b) || String(b.start).localeCompare(String(a.start)));
      const title = `${best ? "Best" : "Worst"} event${opts.byRecord ? "" : " finish"}${where}`;
      const rule = opts.byRecord ? `${FINISH_BASE} On equal ranks, the ${best ? "better" : "worse"} record there (win share, a tie counting half), then the latest event.` : FINISH_RULE;
      const e = sorted[0];
      if (!e) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: rule, source: evSource, none: none("ranked events") };
      return {
        ...base, family: "superlative", intent: id, title, source: evSource, definition: rule,
        headline: { value: rankText(e), label: e.name, sub: [e.record ? `${evRec(e)} there` : "", seasonLabel(e.season), dateRange(e.start, e.end), place(e.city, e.state)].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) },
        blocks: [eventRows(sorted.slice(0, 5), team.number, best ? "Best finishes" : "Lowest finishes")],
      };
    }
    case "first-place-events": {
      // A placement, never an award: ranked #1 at the end of qualifications (league meets left out: their rank is the
      // league's running standing). The event's Winning Alliance and Inspire Award are the event wins' answer.
      const firsts = evs.filter((e) => e.rank === 1 && e.type !== "LeagueMeet").reverse();
      const title = `Events ranked 1st${where}`;
      const def = `Ranked 1st: the team's qualification rank at the event was #1, a placement, not an award. ${FINISH_BASE} Winning Alliance and Inspire Award wins are a separate answer (${team.number} event wins).`;
      const related: StatBlock = { kind: "related", title: "Awards, listed apart", queries: [`${team.number} event wins`] };
      if (!firsts.length) return { ...base, family: "superlative", intent: id, title, blocks: [related], definition: def, source: evSource, none: `${who} wasn't ranked 1st at any event${where} on record (league meets aside).` };
      const rows = eventRows(firsts, team.number, "Each one, newest first", { opr: false });
      if (rows.kind === "table") rows.rows = rows.rows.map((r) => ({ ...r, cells: { ...r.cells, rank: `Ranked ${r.cells.rank}` } }));
      return {
        ...base, family: "superlative", intent: id, title, source: evSource, definition: def,
        headline: { value: `${firsts.length} event${firsts.length === 1 ? "" : "s"}`, label: `ranked #1 after qualifications${where}`, sub: `Latest: ${firsts[0].name}, ${seasonLabel(firsts[0].season)}${firsts[0].record ? `, ${evRec(firsts[0])}` : ""}`, href: eventHref(firsts[0].season, firsts[0].code, team.number) },
        blocks: [rows, related],
      };
    }
    case "worlds-divisions": {
      // One line per championship season: its division (where the team ranked); the finals noted when played.
      const seasons = [...new Set(evs.map((e) => e.season))].sort((a, b) => b - a);
      const apps = seasons.map((s) => {
        const xs = evs.filter((e) => e.season === s);
        const division = xs.find((e) => e.division != null && e.rank != null) ?? xs.find((e) => e.division != null) ?? xs[0];
        return { division, finals: xs.some((e) => e !== division && e.division == null) };
      });
      const title = `Worlds divisions${scope.season != null ? ` in ${seasonLabel(scope.season)}` : ""}`;
      if (!apps.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: WORLDS_RULE, source: evSource, none: `No Worlds appearances found in ${possessive(who)} recorded event history${scope.season != null ? ` for ${seasonLabel(scope.season)}` : ""}.` };
      const rows = eventRows(apps.map((a) => a.division), team.number, "Each appearance, newest first", { opr: false });
      if (rows.kind === "table") rows.rows = rows.rows.map((r, i) => (apps[i].finals ? { ...r, cells: { ...r.cells, event: `${r.cells.event} (played the finals)` } } : r));
      return {
        ...base, family: "aggregate", intent: id, title, source: evSource, definition: WORLDS_RULE,
        headline: { value: `${apps.length} appearance${apps.length === 1 ? "" : "s"}`, label: apps.map((a) => `${a.division.name.replace(/^Worlds · /, "")} ${seasonLabel(a.division.season)}`).join(" · ") },
        blocks: [rows],
      };
    }
    case "first-event":
    case "last-event": {
      const e = id === "first-event" ? evs[0] : evs[evs.length - 1];
      const title = `${id === "first-event" ? "First" : "Most recent"} event${where}`;
      if (!e) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: EVENT_RULE, source: evSource, none: none("events") };
      return {
        ...base, family: "superlative", intent: id, title, source: evSource, definition: EVENT_RULE,
        headline: { value: e.name, label: [e.rank != null ? `Ranked #${e.rank}${e.of ? ` of ${e.of}` : ""}` : "", e.opr != null ? `OPR ${opr(e.opr)}` : ""].filter(Boolean).join(" · ") || "No rank posted", sub: [seasonLabel(e.season), dateRange(e.start, e.end), place(e.city, e.state)].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) },
        blocks: [eventRows(id === "first-event" ? evs.slice(0, 5) : [...evs].reverse().slice(0, 5), team.number, id === "first-event" ? "First events" : "Latest events")],
      };
    }
    case "best-opr-event": {
      const withOpr = evs.filter((e) => e.opr != null).sort((a, b) => b.opr! - a.opr!);
      const title = `Best OPR event${where}`;
      // Each season is a different game, so an OPR is never compared across seasons: with several and none named, the
      // answer is the latest season's best event (said so), and each season's best is listed below it.
      const per = [...new Set(withOpr.map((x) => x.season))].sort((a, b) => b - a).map((s) => withOpr.find((x) => x.season === s)!);
      const e = withOpr[0] && per.length > 1 ? per[0] : withOpr[0];
      const def = `OPR at an event: the team's offensive power rating there without penalties, as its team page shows.${per.length > 1 ? ` Each season is a different game, so an OPR is never compared across seasons: the answer is ${seasonLabel(e.season)}'s best event, the latest season here, and each season's best is listed below.` : ""}`;
      if (!e) return { ...base, family: "superlative", intent: id, title, blocks: [], definition: def, source: evSource, none: none("events with an OPR") };
      const season = set.seasons.find((s) => s.season === e.season);
      return {
        ...base, family: "superlative", intent: id, title, source: evSource, definition: def,
        headline: { value: `OPR ${opr(e.opr)}`, label: e.name, sub: [seasonLabel(e.season), season ? `season OPR rank ${topText(season)}` : ""].filter(Boolean).join(" · "), href: eventHref(e.season, e.code, team.number) },
        blocks: [
          { kind: "bars", title: "OPR by phase at that event", groups: [{ label: e.name, items: [{ label: "Auto", value: e.auto, tone: "a" }, { label: "TeleOp", value: e.teleop, tone: "b" }, { label: "Endgame", value: e.endgame, tone: "c" }] }] },
          eventRows(per.length > 1 ? per : withOpr.slice(0, 5), team.number, per.length > 1 ? "Best OPR event each season" : "Best OPR events"),
        ],
      };
    }
    case "total-events": {
      const title = `Events played${where}`;
      if (!evs.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: EVENT_RULE, source: evSource, none: none("events") };
      const per = [...new Set(evs.map((e) => e.season))].sort((a, b) => b - a);
      return {
        ...base, family: "aggregate", intent: id, title, source: evSource, definition: EVENT_RULE,
        headline: { value: `${evs.length} event${evs.length === 1 ? "" : "s"}`, label: `over ${per.length} season${per.length === 1 ? "" : "s"}${where}` },
        blocks: [
          { kind: "bars", title: "Events each season", groups: [...per].reverse().map((s) => ({ label: seasonLabel(s), items: [{ label: "Events", value: evs.filter((e) => e.season === s).length, tone: "a" as const }] })) },
          eventRows([...evs].reverse(), team.number, "Events, newest first"),
        ],
      };
    }
    case "average-rank": {
      const ranked = evs.filter((e) => e.rank != null && e.type !== "LeagueMeet");
      const title = `Average event rank${where}`;
      if (!ranked.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: FINISH_RULE, source: evSource, none: none("ranked events") };
      const mean = ranked.reduce((a, e) => a + e.rank!, 0) / ranked.length;
      return {
        ...base, family: "aggregate", intent: id, title, source: evSource, definition: `${FINISH_RULE} The average is the mean of those ranks.`,
        headline: { value: `#${mean.toFixed(1)}`, label: `mean rank over ${ranked.length} event${ranked.length === 1 ? "" : "s"}`, sub: `Best #${Math.min(...ranked.map((e) => e.rank!))} · lowest #${Math.max(...ranked.map((e) => e.rank!))}` },
        blocks: [{ kind: "series", title: "Rank at each event (lower is better)", unit: "rank", points: ranked.map((e) => ({ x: e.name, y: e.rank, href: eventHref(e.season, e.code, team.number), note: seasonLabel(e.season) })) }],
      };
    }
    case "seasons-played":
    case "seasons-count":
    case "first-season":
    case "best-season":
    case "most-improved-season": {
      const titles: Record<string, string> = { "seasons-played": "Seasons played", "seasons-count": "How many seasons", "first-season": "First season", "best-season": "Best season", "most-improved-season": "Most improved season" };
      const title = titles[id];
      if (!ss.length) return { ...base, family: "aggregate", intent: id, title, blocks: [], definition: SEASON_RULE, source: ssSource, none: `No seasons with matches found for ${who}.` };
      if (id === "seasons-played" || id === "seasons-count") {
        return {
          ...base, family: "aggregate", intent: id, title, source: ssSource, definition: "A season played: one with at least one scored match on record.",
          headline: { value: `${ss.length} season${ss.length === 1 ? "" : "s"}`, label: ss.map((s) => seasonLabel(s.season)).join(", ") },
          blocks: [seasonRows(ss, "Each season")],
        };
      }
      if (id === "first-season") {
        const s = ss[0];
        return {
          ...base, family: "superlative", intent: id, title, source: ssSource, definition: "The first season with a scored match on record (the team's rookie year is on its team page).",
          headline: { value: seasonLabel(s.season), label: `${rec(s)} in ${s.matches} matches at ${s.events} event${s.events === 1 ? "" : "s"}`, sub: `OPR ${opr(s.opr)} · ${topText(s)}`, href: teamHref(team.number, s.season) },
          blocks: [seasonRows(ss.slice(0, 1), "Debut season")],
        };
      }
      if (id === "best-season") {
        // Record and standing, equally: the season's win rate and its OPR standing (1 − its top-percent share), averaged.
        const winRate = (x: TeamSeason) => { const g = x.wins + x.losses + x.ties; return g ? x.wins / g : 0; };
        const score = (x: TeamSeason) => (winRate(x) + (1 - top(x)!)) / 2;
        const ranked = ss.filter((s) => top(s) != null).sort((a, b) => score(b) - score(a) || top(a)! - top(b)!);
        const s = ranked[0];
        if (!s) return { ...base, family: "superlative", intent: id, title, blocks: [seasonRows(ss, "Each season")], definition: SEASON_RULE, source: ssSource, none: `No season with an OPR rank found for ${who}.` };
        return {
          ...base, family: "superlative", intent: id, title, source: ssSource, definition: `Best season: the season with the best record and OPR standing together (its win rate and its OPR standing, 1 minus its top-percent share, averaged). ${SEASON_RULE}`,
          headline: { value: seasonLabel(s.season), label: `${rec(s)} (${Math.round(100 * winRate(s))}% wins) · OPR ${topText(s)}`, sub: `OPR ${opr(s.opr)} in ${seasonLabel(s.season)}'s game`, href: teamHref(team.number, s.season) },
          blocks: [seasonRows(ss, "Each season", s), { kind: "series", title: "Top-percent OPR rank each season (lower is better)", unit: "%", points: ss.map((x) => ({ x: seasonLabel(x.season), y: top(x) == null ? null : Math.max(1, Math.round(100 * top(x)!)) })) }],
        };
      }
      // Most improved: the biggest gain in OPR rank share between two seasons in a row.
      const ranked = ss.filter((s) => top(s) != null);
      let bestGain: { from: TeamSeason; to: TeamSeason; gain: number } | null = null;
      for (let i = 1; i < ranked.length; i++) {
        if (ranked[i].season !== ranked[i - 1].season + 1) continue;
        const gain = top(ranked[i - 1])! - top(ranked[i])!;
        if (!bestGain || gain > bestGain.gain) bestGain = { from: ranked[i - 1], to: ranked[i], gain };
      }
      const def = `Most improved: the biggest rise in OPR rank share from one season to the next. ${SEASON_RULE}`;
      if (!bestGain || bestGain.gain <= 0) return { ...base, family: "superlative", intent: id, title, blocks: [seasonRows(ss, "Each season")], definition: def, source: ssSource, none: ranked.length < 2 ? `${who} needs two ranked seasons in a row to compare.` : `${possessive(who)} OPR rank didn't rise from one season to the next.` };
      return {
        ...base, family: "superlative", intent: id, title, source: ssSource, definition: def,
        headline: { value: seasonLabel(bestGain.to.season), label: `from top ${Math.round(100 * top(bestGain.from)!)}% to top ${Math.max(1, Math.round(100 * top(bestGain.to)!))}% by OPR rank`, sub: `OPR rank #${bestGain.from.rank} of ${bestGain.from.of} in ${seasonLabel(bestGain.from.season)} → #${bestGain.to.rank} of ${bestGain.to.of} in ${seasonLabel(bestGain.to.season)}`, href: teamHref(team.number, bestGain.to.season) },
        blocks: [seasonRows(ss, "Each season", bestGain.to)],
      };
    }
    default:
      return null;
  }
}
