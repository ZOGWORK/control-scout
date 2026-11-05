// Search's answer for a compound question (./compound.ts reads it, ./families/compound.ts answers it): the team found as
// search finds it, the season as every stat answer chooses it (the one named, else the default season when the team
// played it, else its latest), and the card worked out for /search only, never per keystroke.
import type { SearchAnswer, SearchHit, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { findRegions } from "../../../src/shared/regions.js";
import { teamNameOf } from "../../../src/shared/teamTitle.js";
import type { Scope } from "./clauses.js";
import type { CompoundQuestion, SeasonWords } from "./compound.js";
import { fuzzyScore } from "../fuzzy.js";
import { teamEventSet, type TeamEvent } from "./eventSet.js";
import { teamMatches } from "./matchSet.js";
import { searchSeason } from "./season.js";
import { awardsAnswer } from "./families/awards.js";
import { beatTopAnswer, combinedAnswer, eventPairAnswer, eventPicksAnswer, listAnswer, listTitle, marginAnswer, oprExcludingAnswer, reliabilitySetAnswer, sideThresholdAnswer, winLossAverageAnswer } from "./families/compound.js";
import { matchAnswer, whoOf, type AnswerTeam } from "./families/matches.js";
import { compareAnswer } from "./families/twoTeam.js";
import type { Resolve } from "./index.js";

/** What index.ts already decides for every stat answer, passed in so both read the same rule. */
export interface CompoundDeps {
  latestSeason: (team: number) => Promise<{ season: number; own: boolean } | null>;
  /** The event the words name (`primary`) and the events read as it (`events`: a championship named takes in its
   *  division and the finals; a division named is that division alone). */
  pickTeamEvent: (evs: TeamEvent[], words: string, season: number | null) => { primary: TeamEvent; events: TeamEvent[] } | null;
}
type Opts = { full: boolean; pages: SearchPageLink[] };

const TITLES: Record<Exclude<CompoundQuestion["kind"], "list" | "set-best">, string> = {
  "event-pair": "OPR at their first event, two seasons", margin: "Matches by margin", combined: "Two answers", "side-threshold": "Partners by OPR",
  "beat-top": "Wins against top-ranked teams", "event-picks": "Best and worst events", "win-loss-average": "Average score in wins and losses", "opr-excluding": "OPR without one event",
};

/** The season a team's answer reads: the one named; every season for "ever"; else the default season, or the team's
 *  latest with matches (said so). */
async function seasonFor(w: SeasonWords, team: number, deps: CompoundDeps, everAllowed = true): Promise<{ season: number | null; why?: string }> {
  if (w.season != null) return { season: w.season, ...(w.latest ? { why: `"This season" here is ${seasonLabel(w.season)}, the latest completed season.` } : {}) };
  if (w.ever && everAllowed) return { season: null };
  const l = await deps.latestSeason(team);
  if (!l) return { season: null };
  return { season: l.season, why: l.own ? `The season is ${seasonLabel(l.season)}: no ${seasonLabel(searchSeason())} matches on record, so the team's latest season with matches.` : `With no season named, the season is ${seasonLabel(l.season)}, the latest completed season (its FIRST Championship has finished).` };
}

/** Two of the team's events that name the words about as well (pickTeamEvent picks neither) but are one championship:
 *  a division and its finals ("New Jersey Championship - Northern Division", "New Jersey Championship"). The division. */
function familyPick(evs: TeamEvent[], words: string, season: number | null): TeamEvent | null {
  const scored = evs.filter((e) => season == null || e.season === season)
    .map((e) => ({ e, s: Math.max(fuzzyScore(words, e.name), fuzzyScore(words, e.code)) })).filter((x) => x.s >= 0.75)
    .sort((a, b) => b.s - a.s || b.e.season - a.e.season);
  const [a, b] = scored;
  if (!a || !b || a.e.season !== b.e.season) return null;
  return a.e.division === b.e.code ? a.e : b.e.division === a.e.code ? b.e : null;
}

/** An event named that the team has no match at ("17713 partners at NJ championship"): said so, with its own events
 *  (the season named, else its latest) to open instead. Never another event's partners. */
function noEventAnswer(q: string, words: string, team: AnswerTeam, top: SearchHit, evs: TeamEvent[], season: number | null, opts: Opts): SearchAnswer {
  const played = evs.filter((e) => e.matches > 0 || e.record != null);
  const s = season ?? (played.length ? Math.max(...played.map((e) => e.season)) : null);
  const own = played.filter((e) => e.season === s);
  const title = `No event matching "${words}"`;
  const stat: StatAnswer = {
    family: "event", intent: "no-event", title, team, scope: s != null ? [seasonLabel(s)] : ["All seasons"],
    definition: "An event is one the team played at, found by its name or code, in the season named (else any season).", source: `Checked ${played.length} event${played.length === 1 ? "" : "s"} ${whoOf(team)} played`,
    none: `${whoOf(team)} has no matches at an event matching "${words}"${season != null ? ` in ${seasonLabel(season)}` : ""}.${own.length && s != null ? ` Its ${seasonLabel(s)} events are below.` : ""}`,
    blocks: own.length && s != null ? [{ kind: "links", title: `${whoOf(team)}'s events, ${seasonLabel(s)}`, items: own.map((e) => ({ label: e.name, href: `/events/${e.season}/${encodeURIComponent(e.code)}?team=${team.number}`, ...(e.start ? { sub: e.start.slice(0, 10) } : {}) })) }] : [],
  };
  return {
    q, hits: [{ ...top, section: "history", facts: undefined, events: undefined }], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: `${whoOf(team)} · ${title}` },
    intent: { kind: "stat-compound-no-event", pattern: "[team] partners at [event]", met: false, understood: [`Team ${whoOf(team)}`, title] },
    ...(opts.full ? { stat } : {}),
  };
}

export async function compoundSearch(q: string, c: CompoundQuestion, resolve: Resolve, opts: Opts, deps: CompoundDeps): Promise<SearchAnswer | null> {
  if (c.kind === "list") return listSearch(q, c, opts);
  if (c.kind === "set-best") return setSearch(q, c, resolve, opts);
  const base = await resolve(c.core);
  const top = base.step !== "recovery" ? base.hits[0] : undefined;
  if (!top || top.kind !== "team" || top.href) return null;
  const team: AnswerTeam = { number: Number(top.ref), name: teamNameOf(top.title) || null };
  const guessed = base.step === "did-you-mean";
  const answer = (label: string, season: number | null, section: SearchHit["section"]): SearchAnswer => ({
    q, hits: [{ ...top, section, ...(season != null ? { linkSeason: season } : {}), facts: undefined, events: undefined }, ...base.hits.slice(1).filter((h) => !(h.kind === "team" && h.ref === top.ref))],
    pages: opts.pages, step: guessed ? "did-you-mean" : "deterministic", weak: guessed && base.weak,
    ...(guessed && base.didYouMean ? { didYouMean: q.toLowerCase().includes(c.core) ? q.toLowerCase().replace(c.core, base.didYouMean) : base.didYouMean } : {}),
    understood: { kind: "question", label, ...(season != null ? { season } : {}) },
    intent: { kind: `stat-compound-${c.kind}`, pattern: `[team] ${c.kind}`, met: true, understood: [`Team ${whoOf(team)}`, TITLES[c.kind]] },
  });
  const done = (a: SearchAnswer, stat: StatAnswer | null, why?: string): SearchAnswer | null => {
    if (!stat) return null;
    if (why) stat.definition = `${stat.definition} ${why}`;
    return { ...a, understood: { ...a.understood!, label: `${whoOf(team)} · ${stat.title}` }, stat };
  };
  if (c.kind === "event-pair") {
    const a = answer(`${whoOf(team)} · ${TITLES[c.kind]}`, c.seasons[0], "history");
    if (!opts.full) return a;
    const set = await teamEventSet(team.number);
    return done(a, eventPairAnswer(team, set.events, set.seasons, c.which, c.seasons));
  }
  const s = await seasonFor(c.when, team.number, deps, c.kind === "margin" || c.kind === "beat-top" || c.kind === "combined" || c.kind === "win-loss-average");
  const scope: Scope = { season: s.season };
  let family: TeamEvent[] = [];
  const section: SearchHit["section"] = c.kind === "combined" ? "awards" : c.kind === "event-picks" || c.kind === "opr-excluding" ? "history" : "matches";
  // An event named ("partners at NJ championship"): one the team attended, in the season named; none is left to search.
  if (c.kind === "side-threshold" && c.at) {
    const evs = (await teamEventSet(team.number)).events;
    // A state's code in the event's words ("nj championship") is also tried as the state's name ("new jersey").
    const named = c.at.replace(/\b[a-z]{2}\b/g, (w) => findRegions(w).find((r) => r.state.toLowerCase() === w)?.name.toLowerCase() ?? w);
    const fp = familyPick(evs, named, c.when.season);
    const pick = deps.pickTeamEvent(evs, c.at, c.when.season) ?? (named !== c.at ? deps.pickTeamEvent(evs, named, c.when.season) : null)
      ?? (fp ? { primary: fp, events: evs.filter((x) => x.season === fp.season && (x.code === fp.code || x.code === fp.division)) } : null);
    if (!pick) return noEventAnswer(q, c.at, team, top, evs, c.when.season, opts);
    // The events picked are read as one: a championship named is its division and its finals together, a division
    // named is that division alone (never the finals with it).
    const e = pick.primary;
    family = pick.events;
    const finals = family.length > 1 ? family.find((x) => x.division == null && family.some((y) => y.division === x.code)) : undefined;
    scope.season = null;
    scope.event = { season: e.season, code: e.code, name: family.length > 1 && finals ? finals.name : e.name };
    s.why = undefined;
  }
  const a = answer(`${whoOf(team)} · ${TITLES[c.kind]}`, scope.season ?? scope.event?.season ?? null, section);
  if (!opts.full) return a;
  switch (c.kind) {
    case "margin": return done(a, await marginAnswer(team, await teamMatches(team.number), scope, c.result, c.margin), s.why);
    case "win-loss-average": return done(a, winLossAverageAnswer(team, await teamMatches(team.number), scope), s.why);
    case "beat-top": return done(a, await beatTopAnswer(team, await teamMatches(team.number), scope, c.n, c.by), s.why);
    case "side-threshold": return done(a, await sideThresholdAnswer(team, await teamMatches(team.number), scope, c.side, c.threshold, family.length > 1 ? family.find((x) => x.division == null && family.some((y) => y.division === x.code))?.code ?? null : null), s.why);
    case "event-picks": case "opr-excluding": {
      if (s.season == null) return null;
      const set = await teamEventSet(team.number);
      return done(a, c.kind === "event-picks" ? eventPicksAnswer(team, set.events, s.season, c.picks, s.why) : oprExcludingAnswer(team, set.events, set.seasons, s.season, c.drop, s.why));
    }
    case "combined": {
      const ms = await teamMatches(team.number);
      const parts: StatAnswer[] = [];
      const summary: { label: string; value: string; sub?: string; href?: string }[] = [];
      for (const p of c.parts) {
        if (p === "record") {
          const r = await matchAnswer("record", team, ms, scope, {});
          if (!r) return null;
          parts.push(r);
          summary.push({ label: "Record", value: r.headline?.value ?? "–", ...(r.headline?.label ? { sub: r.headline.label } : {}) });
        } else if (p === "awards") {
          const r = await awardsAnswer("awards", team, scope, { count: false });
          if (!r) return null;
          parts.push(r);
          summary.push({ label: "Awards", value: r.headline?.value ?? "0", ...(r.headline?.label ? { sub: r.headline.label } : {}), href: `/teams/${team.number}${scope.season != null ? `?season=${scope.season}` : ""}#awards` });
        } else {
          if (scope.season == null) return null;
          const row = (await teamEventSet(team.number)).seasons.find((x) => x.season === scope.season);
          const S = seasonLabel(scope.season);
          parts.push({ family: "stat", intent: "opr", title: `OPR in ${S}`, team, scope: [S], definition: "OPR: the season's stored offensive power rating without penalties, by phase, as the team page shows it.", source: `From ${whoOf(team)}'s ${S} season numbers`,
            blocks: row?.opr != null ? [{ kind: "kpis", items: (["np", "auto", "teleop", "endgame"] as const).map((k) => ({ label: k === "np" ? "OPR" : k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", value: (Math.round((k === "np" ? row.opr! : row[k] ?? 0) * 10) / 10).toFixed(1), ...(k === "np" ? (row.rank ? { sub: `#${row.rank} of ${row.of ?? "?"} worldwide` } : {}) : { phase: k }) })) }] : [],
            ...(row?.opr != null ? {} : { none: `No ${S} OPR for ${whoOf(team)}.` }) });
          summary.push({ label: "OPR", value: row?.opr != null ? (Math.round(row.opr * 10) / 10).toFixed(1) : "–", ...(row?.rank ? { sub: `#${row.rank} of ${row.of ?? "?"} worldwide` } : {}) });
        }
      }
      return done(a, combinedAnswer(team, scope, parts, summary), s.why);
    }
  }
}

/** "Top 5 NJ teams by auto opr who also won inspire": no team, a filtered list; the search box links to the page. */
async function listSearch(q: string, c: Extract<CompoundQuestion, { kind: "list" }>, opts: Opts): Promise<SearchAnswer | null> {
  const label = listTitle(c, c.city ? c.city.replace(/\b\w/g, (x) => x.toUpperCase()) : null);
  const answer: SearchAnswer = {
    q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, season: c.season ?? searchSeason(), ...(c.region ? { place: { key: c.region.key, name: c.region.name } } : {}) },
    intent: { kind: "stat-compound-list", pattern: `teams${c.region ? " [place]" : c.city ? " [city]" : ""}${c.award ? " [award]" : ""}${c.worlds ? " [worlds]" : ""}${c.threshold ? " [threshold]" : ""}`, met: true, understood: [label] },
  };
  if (!opts.full) return { ...answer, pages: [{ title: label, href: `/search?q=${encodeURIComponent(q)}` }, ...opts.pages] };
  const stat = await listAnswer(c);
  return stat ? { ...answer, understood: { ...answer.understood!, label: stat.title }, stat } : null;
}

/** "12345 vs 67890 vs 33950 which has highest reliability": each team found by its number. */
async function setSearch(q: string, c: Extract<CompoundQuestion, { kind: "set-best" }>, resolve: Resolve, opts: Opts): Promise<SearchAnswer | null> {
  const hits = await Promise.all(c.teams.map(async (n) => (await resolve(String(n))).hits.find((h) => h.kind === "team" && h.ref === String(n) && !h.href)));
  if (hits.some((h) => !h)) return null;
  const found = hits as SearchHit[];
  const teams = found.map((h) => ({ number: Number(h.ref), name: teamNameOf(h.title) || null }));
  const what = c.stat === "reliability" ? "Highest reliability" : "Highest OPR";
  const label = `${what}: ${teams.map(whoOf).join(" vs ")}`;
  const answer: SearchAnswer = {
    q, hits: found.map((h) => ({ ...h, facts: undefined, events: undefined })), pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(c.when.season != null ? { season: c.when.season } : {}) },
    intent: { kind: `stat-compound-set-${c.stat}`, pattern: `[team] [team] [team] highest ${c.stat}`, met: true, understood: [`Teams ${teams.map(whoOf).join(", ")}`, what] },
  };
  if (!opts.full) return answer;
  const stat = c.stat === "reliability" ? await reliabilitySetAnswer(teams, c.when.season) : await compareAnswer(teams, { season: c.when.season });
  return { ...answer, understood: { ...answer.understood!, label: stat.title.startsWith("Reliability") ? stat.title : label }, stat };
}
