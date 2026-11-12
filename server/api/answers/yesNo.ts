// A yes-or-no question about a team ("has <team> ever been to worlds", "did <team> play at <event> in <season>", "has
// <team> ever won inspire", "did <team> ever lose to <team>"): "Yes" or "No" first, then the evidence: the events, the
// awards or the matches that prove it, each linked. "No" is an answer, with what the team did instead (the events it
// played), never the no-match page. The question is read by the pipeline's parser (../query/parse.ts); three shapes
// are answered, every other one is left to search's readers (null).
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer, StatBlock } from "../../../src/shared/searchStat.js";
import { dateRange, place, seasonLabel } from "../../../src/shared/format.js";
import { all, get } from "../../db.js";
import { normalise, parseQuery, type Parsed } from "../query/parse.js";
import { fold, type Place } from "../query/names.js";
import { parseContext } from "../query/context.js";
import { eventsNamed } from "../query/highlights.js";
import { eventKindOf } from "../query/matchFind.js";
import { CHAMPIONSHIP_TYPE, OFFICIAL_TYPES, STATES_TYPE } from "./clauses.js";
import { eventHref, matchRow, shortEvent, teamLinks, teamMatches } from "./matchSet.js";
import { relativeSeason, teamSeason } from "./season.js";

/** How a yes-or-no question opens, or "ever" anywhere in it ("4215 ever at worlds"). Never a question word first. */
const FRAME = /^(?:has|have|had|did|does|do|was|were|is|are)\s|\bever\b/;
const ASKS = /^(?:how|when|who|whom|what|which|where|why)\b/;
/** The verbs around "been to", "go to", "make it to": the question's frame, never a name ("ever" too, left over when a
 *  season is also said). */
const VERBS = /^(?:ever|go|goes|went|gone|get|got|make|made|it|compete|competes|competed|attend|attends|attended|appear|appeared|qualify|qualified|reach|reached|advance|advanced|been|visit|visited)$/;

type Team = { number: number; name: string | null };
const who = (t: Team) => `${t.name ?? `Team ${t.number}`} (${t.number})`;
const yes = (v: boolean) => (v ? "Yes" : "No");

/** The events the question is about: a FIRST Championship, the team's state championship, an event named, or a kind
 *  of event; the season said narrows it. Null when the question names none of these. */
interface EventScope { label: string; types?: readonly string[]; codes?: Set<string>; ownRegion?: boolean; season: number | null; year: number | null;
  /** A kind of event ("a championship"), not one event. */
  kind?: boolean;
  /** Only a time ("in 2024–25"): its label is said as it is, never "at …". */
  bare?: boolean }
/** Where a scope is said after a verb: "at Worlds", or a time alone ("in 2024–25"). */
const at = (s: EventScope) => (s.bare ? s.label : `at ${s.label}`);
/** Official events only, as every answer counts them: an off-season event's matches and awards are never the record. */
const OFFICIAL = `e.type IN (${OFFICIAL_TYPES.map((t) => `'${t}'`).join(", ")})`;

/** The season the question says, by the one season rule (./season.ts): "this season" is the team's latest season with
 *  matches (the current one when nobody is named), "last season" the latest completed one. */
async function timeOf(p: Parsed): Promise<{ season: number | null; year: number | null } | undefined> {
  const t = p.time;
  if (!t || t.kind === "ever") return { season: null, year: null };
  if (t.kind === "window") return undefined;
  if (t.relative === "this" && p.teams.length === 1) return { season: (await teamSeason(p.teams[0].number)) ?? relativeSeason("this", null), year: null };
  if (t.relative) return { season: relativeSeason(t.relative, null), year: null };
  return t.year != null ? { season: null, year: t.year } : { season: t.season, year: null };
}

async function scopeOf(p: Parsed): Promise<EventScope | null | undefined> {
  const when = await timeOf(p);
  if (!when) return undefined;
  const said = when.season != null ? ` in ${seasonLabel(when.season)}` : when.year != null ? ` in ${when.year}` : "";
  if (p.worlds) return { label: `Worlds${said}`, types: [CHAMPIONSHIP_TYPE], ...when };
  if (p.states) return { label: `their state championship${said}`, types: [STATES_TYPE], ownRegion: true, ...when };
  if (p.event) {
    const all = await eventsNamed(normalise(p.event.words), null);
    // Its name as the season asked held it (the main event's, not a division's), else the latest season's.
    const evs = all.filter((e) => (when.season == null || e.season === when.season) && (when.year == null || (e.start ?? "").startsWith(String(when.year))));
    if (!evs.length) return undefined;
    const main = [...evs].sort((a, b) => b.season - a.season || Number(a.division != null) - Number(b.division != null))[0];
    const name = shortEvent(main.name, main.type);
    // The events named, each by its own code: a championship named takes its divisions (inScope), a division named
    // is that division alone.
    return { label: `${name}${said}`, codes: new Set(evs.map((e) => e.code)), ...when };
  }
  if (p.eventKind) {
    const k = eventKindOf(p.eventKind);
    return k ? { label: `${k.label.toLowerCase().replace(/s$/, "")}${said}`, types: k.types, kind: true, ...when } : undefined;
  }
  // A season or a year said alone still narrows the answer ("has <team> won inspire in 2024-25").
  return said ? { label: said.trim(), bare: true, ...when } : null;
}

interface EventRow { season: number; code: string; name: string; type: string | null; division_code: string | null; start: string | null; end: string | null; region: string | null; wins: number | null; losses: number | null; ties: number | null }

/** The events `team` played a match at, newest first: a qualification match on its record, or any match it was on the
 *  field for (a championship's finals hold playoffs only). */
async function playedAt(team: number): Promise<EventRow[]> {
  const onField = [...new Set((await teamMatches(team)).filter((m) => m.onField).map((m) => `${m.season}|${m.code}`))];
  return all<EventRow>(`SELECT e.season, e.code, e.name, e.type, e.division_code, e.start, e.end, e.region, s.wins, s.losses, s.ties
    FROM events e LEFT JOIN team_event_stats s ON s.season = e.season AND s.code = e.code AND s.team = ?
    WHERE ${OFFICIAL} AND (s.matches > 0${onField.length ? ` OR (e.season || '|' || e.code) IN (${onField.map(() => "?").join(", ")})` : ""})
    ORDER BY e.start DESC, e.code`, [team, ...onField]);
}

const inScope = (s: EventScope, home: string | null) => (e: EventRow) =>
  (s.season == null || e.season === s.season) && (s.year == null || (e.start ?? "").startsWith(String(s.year)))
  && (!s.types || s.types.includes(e.type ?? "")) && (!s.codes || s.codes.has(e.code) || (!!e.division_code && s.codes.has(e.division_code)))
  && (!s.ownRegion || (!!home && e.region === home));

const eventTable = (title: string, rows: EventRow[], team: number): StatBlock => ({
  kind: "table", title, columns: [{ key: "event", label: "Event" }, { key: "season", label: "Season" }, { key: "when", label: "Dates" }, { key: "record", label: "Record" }],
  rows: rows.map((e) => ({ cells: { event: shortEvent(e.name, e.type), season: seasonLabel(e.season), when: dateRange(e.start, e.end) || null, record: e.wins == null ? null : `${e.wins}-${e.losses ?? 0}-${e.ties ?? 0}` }, href: eventHref(e.season, e.code, team), type: e.type })),
});

/** "Has <team> been to <scope>": the events in it the team played at, or the ones it played instead. */
async function attended(t: Team, s: EventScope): Promise<StatAnswer> {
  const home = (await get<{ r: string | null }>("SELECT home_region r FROM teams WHERE number = ?", [t.number]))?.r ?? null;
  const events = await playedAt(t.number);
  // A division and its championship are one trip: the division is listed.
  const hit = events.filter(inScope(s, home));
  const rows = hit.filter((e) => !hit.some((d) => d.division_code === e.code && d.season === e.season));
  const ok = rows.length > 0;
  const trips = new Set(rows.map((e) => e.season)).size;
  // Instead: its events in the season asked, else its latest season's.
  const latest = s.season ?? events[0]?.season ?? null;
  const instead = events.filter((e) => e.season === latest).slice(0, 8);
  return {
    family: "event", intent: "yes-no-attended", title: `${who(t)} at ${s.label}`, team: t, scope: [s.season != null ? seasonLabel(s.season) : s.year != null ? String(s.year) : "All seasons"],
    headline: { value: yes(ok), label: ok ? `${who(t)} played ${at(s)}${s.season == null && s.year == null && trips > 1 ? `: ${trips} seasons` : ""}` : `${who(t)} has never played ${at(s)}` },
    blocks: ok ? [eventTable("Where they played", rows, t.number)] : instead.length ? [eventTable(`The events they played${latest != null ? ` in ${seasonLabel(latest)}` : ""}`, instead, t.number)] : [],
    definition: "Played: the team was on the field for at least one match there. A championship's division counts as the championship.",
    source: `From ${events.length} ${events.length === 1 ? "event" : "events"} on record`,
  };
}

/** "From", "based in", "located in": a question about where a team is from. */
const FROM = /\b(?:from|based\s+in|located\s+in)\b/;

/** "Is <team> from <place>": yes or no, then where the team is from in full, its country always named (FIRST's
 *  listing: city, state or province, country). */
async function fromPlace(t: { number: number; name: string | null }, pl: Place): Promise<StatAnswer | null> {
  const row = await get<{ city: string | null; state: string | null; country: string | null }>("SELECT city, state, country FROM teams WHERE number = ?", [t.number]);
  if (!row?.country) return null;
  const ok = row.country === pl.country && (pl.state == null || row.state === pl.state) && (pl.city == null || fold(row.city ?? "") === fold(pl.city));
  const where = place(row.city, row.state, row.country);
  return {
    family: "stat", intent: "yes-no-location", title: `Is ${who(t)} from ${pl.name}?`, team: t, scope: [pl.name],
    headline: { value: yes(ok), label: ok ? `${who(t)} is from ${where}` : `${who(t)} is from ${where}, not ${pl.name}` },
    blocks: [{ kind: "kpis", items: [{ label: "From", value: where, href: `/teams/${t.number}` }, ...(row.country !== pl.country ? [{ label: "Country", value: row.country }] : [])] }],
    definition: "Where a team is from: the city, state or province and country FIRST lists for it.",
    source: "From FIRST's team listing",
  };
}

/** "Has <team> won <award>", or an event won (`eventWin`: "won a championship", its Winning Alliance or 1st-place
 *  Inspire there). The Winning Alliance award asked by name is that award alone. */
async function wonAward(t: Team, award: string | null, s: EventScope | null, eventWin = false): Promise<StatAnswer> {
  const home = (await get<{ r: string | null }>("SELECT home_region r FROM teams WHERE number = ?", [t.number]))?.r ?? null;
  // A judged award is won at 1st place (2nd and 3rd are placings); an alliance award at any slot. FIRST stores its
  // Leadership Award as a Winner too: never an event won.
  const rows = (await all<EventRow & { atype: string; aname: string | null; placement: number }>(
    `SELECT e.season, e.code, e.name, e.type, e.division_code, e.start, e.end, e.region, NULL wins, NULL losses, NULL ties, a.type atype, a.name aname, a.placement
     FROM awards a JOIN events e ON e.season = a.season AND e.code = a.code WHERE a.team = ? AND ${OFFICIAL}${award ? " AND a.type = ?" : ""}
       AND (a.type IN ('Winner', 'Finalist') OR a.placement = 1) AND NOT (a.type = 'Winner' AND COALESCE(a.name, '') LIKE '%Leadership%')
       ${eventWin ? "OR (a.team = ? AND a.type = 'Inspire' AND a.placement = 1 AND " + OFFICIAL + ")" : ""}
     ORDER BY e.start DESC, e.code`, [t.number, ...(award ? [award] : []), ...(eventWin ? [t.number] : [])])).filter((e) => !s || inScope(s, home)(e));
  // An event won is said as the event ("won a championship", "won New Jersey Championship"); an award, with where.
  const what = eventWin ? `won ${!s || s.bare ? "an event" : s.kind ? `a ${s.label}` : s.label}` : award === "Winner" ? "won the Winning Alliance award"
    : award ? `won the ${award.replace(/([a-z])([A-Z])/g, "$1 $2")} Award` : "won an award";
  const where = s && (!eventWin || s.bare) ? ` ${at(s)}` : "";
  const ok = rows.length > 0;
  return {
    family: "awards", intent: "yes-no-award", title: `${who(t)} ${what}${where}`, team: t, scope: [s?.season != null ? seasonLabel(s.season) : "All seasons"],
    headline: { value: yes(ok), label: ok ? `${who(t)} ${what}${where}: ${rows.length} ${rows.length === 1 ? "time" : "times"}` : `${who(t)} has never ${what}${where}` },
    blocks: ok ? [{ kind: "table", title: "Where", columns: [{ key: "award", label: "Award" }, { key: "event", label: "Event" }, { key: "season", label: "Season" }],
      rows: rows.map((r) => ({ cells: { award: r.aname ?? r.atype, event: shortEvent(r.name, r.type), season: seasonLabel(r.season) }, href: eventHref(r.season, r.code, t.number), type: r.type })) }] : [],
    definition: "Won: 1st place of a judged award, or a place on the winning (or finalist) alliance. An event won is its Winning Alliance or its 1st-place Inspire Award, as event wins count it; FIRST's Leadership Award never is.",
    source: "From FIRST's awards on record",
  };
}

/** "Has <team> ever lost to (or beaten) <team>", "did <team> ever play <team>" (`outcome` null): the matches they met
 *  in on opposite alliances. */
async function beaten(a: Team, b: Team, outcome: "W" | "L" | null, s: EventScope | null): Promise<StatAnswer> {
  const home = (await get<{ r: string | null }>("SELECT home_region r FROM teams WHERE number = ?", [a.number]))?.r ?? null;
  const events = s ? new Set((await playedAt(a.number)).filter(inScope(s, home)).map((e) => `${e.season}|${e.code}`)) : null;
  // The matches on the team's record, as the head-to-head counts them: never one it played as a surrogate.
  const met = (await teamMatches(a.number)).filter((m) => m.counted && m.onField && (OFFICIAL_TYPES as readonly string[]).includes(m.type ?? "") && m.opponents.includes(b.number) && (!events || events.has(`${m.season}|${m.code}`))).reverse();
  const hit = outcome ? met.filter((m) => m.result === outcome) : met;
  const links = await teamLinks(met.flatMap((m) => [...m.partners, ...m.opponents]));
  const verb = outcome === "L" ? `lost to ${who(b)}` : outcome === "W" ? `beaten ${who(b)}` : `played against ${who(b)}`;
  const where = s ? ` ${at(s)}` : "";
  const ok = hit.length > 0;
  const wins = met.filter((m) => m.result === "W").length, losses = met.filter((m) => m.result === "L").length, ties = met.length - wins - losses;
  return {
    family: "two-team", intent: "yes-no-beaten", title: `Has ${who(a)} ${verb}${where}?`, team: a, teams: [a, b], scope: [s?.season != null ? seasonLabel(s.season) : "All seasons"],
    headline: { value: yes(ok), label: ok ? `${who(a)} has ${verb}${where}: ${hit.length} ${hit.length === 1 ? "time" : "times"}` : met.length ? `${who(a)} has never ${verb}${where}` : `${who(a)} and ${who(b)} have never played against each other${where}`,
      ...(met.length ? { sub: `${met.length} ${met.length === 1 ? "meeting" : "meetings"}: ${a.number} ${wins}-${losses}-${ties}` } : {}) },
    blocks: met.length ? [{ kind: "matches", title: ok && outcome ? (outcome === "L" ? "Their losses" : "Their wins") : "Every meeting", rows: (ok ? hit : met).slice(0, 25).map((m) => matchRow(m, links, a.number)) }] : [],
    definition: "Meetings are the matches the two teams played on opposite alliances at official events; a win or a loss is the official result, penalties included.",
    source: `From ${met.length} ${met.length === 1 ? "meeting" : "meetings"} on record`,
  };
}

/** The one rule for every other yes-or-no question (server/api/searchAnswer.ts withVerdict): a question framed yes or
 *  no ("did", "has", "was", "ever" …) whose answer card counts something ("2 Inspire Awards", "8 wins", "0 awards") is
 *  "Yes" above a count over zero and "No" above zero, the card kept as the evidence. Null when the question isn't
 *  framed that way or the card's headline isn't a count (an OPR, a record, a name). */
export function derivedVerdict(q: string, a: SearchAnswer): NonNullable<SearchAnswer["verdict"]> | null {
  const n = normalise(q);
  if (!FRAME.test(n) || ASKS.test(n)) return null;
  // A card that found none ("No awards at Worlds found for …") answers No, its own sentence the evidence.
  const none = (a.stat?.none && !a.stat.headline ? a.stat.none : null) ?? (a.card?.none && !a.card.lines.length ? a.card.none : null);
  if (none) return { answer: "No", label: none };
  const head = a.stat?.headline ?? (a.card?.headline ? { value: a.card.headline, label: "" } : undefined);
  const m = head && /^(\d[\d,]*)\s+\p{L}/u.exec(head.value.trim());
  if (!m) return null;
  // A team's number leading the headline ("4215 leads 101.6 – 46.9", "4215 leads 2–0") is who, never a count: a side by
  // side's numbers are no yes or no.
  const named = [a.stat?.team?.number, ...(a.stat?.teams ?? []).map((t) => t.number), ...a.hits.filter((h) => h.kind === "team").map((h) => Number(h.ref))];
  if (named.includes(Number(m[1].replace(/,/g, "")))) return null;
  const count = Number(m[1].replace(/,/g, ""));
  return { answer: count > 0 ? "Yes" : "No", label: [head.value.trim(), head.label, "sub" in head ? head.sub : undefined].filter(Boolean).join(" · ") };
}

/** The answer for a yes-or-no question, or null when `q` isn't one of the shapes answered here. */
export async function yesNoAnswer(q: string, opts: { full: boolean; pages: SearchPageLink[]; now?: number; prefer?: ReadonlySet<string>; resolve: (core: string) => Promise<SearchAnswer> }): Promise<(SearchAnswer & { verdict: NonNullable<SearchAnswer["verdict"]> }) | null> {
  const n = normalise(q);
  if (ASKS.test(n)) return null;
  const p = await parseQuery(q, await parseContext(opts.now, opts.prefer));
  // Losses to a team ("12345 losses to 67890") are the meetings that happened however the question opens: "Yes" or "No"
  // is whether there were any. Every other shape is a yes-or-no question only when framed as one.
  const lostTo = p.teams.length === 2 && p.symbols.includes("metric:opponent") && p.symbols.includes("outcome:L");
  if (!FRAME.test(n) && !lostTo) return null;
  if (p.leftover.some((w) => !VERBS.test(w.toLowerCase())) || p.n != null || p.matchNumber != null || p.level || p.alliance || p.finals) return null;
  // Whether a team is from a place ("is <team> from <place>", "is <team> really based in <place> or what").
  const home = p.place && p.teams.length === 1 && FROM.test(n) && !p.event && !p.eventKind && !p.worlds && !p.states && !p.time && !p.award
    && p.symbols.every((x) => /^(?:prep:\w+|compare|thing:team)$/.test(x)) ? await fromPlace(p.teams[0], p.place) : null;
  if (!home && p.place) return null;
  // "Been to", "went to", "made it to" (metric:appearance) are the question's frame, as its verbs are.
  const sym = new Set(p.symbols.filter((x) => !/^(?:prep|vs)(?::|$)|^(?:worlds|states|metric:appearance)$/.test(x)));
  const scope = await scopeOf(p);
  if (scope === undefined) return null;
  const t = p.teams.map((x) => ({ number: x.number, name: x.name }));
  let stat: StatAnswer | null = home;
  if (stat) { /* answered above */ } else if (t.length === 2 && (sym.has("outcome:L") || sym.has("metric:win")) && [...sym].every((x) => /^(?:metric:(?:opponent|win|loss)|outcome:[WL]|thing:match)$/.test(x))) {
    stat = await beaten(t[0], t[1], sym.has("outcome:L") || sym.has("metric:loss") ? "L" : "W", scope);
  } else if (t.length === 2 && p.symbols.includes("vs") && p.time?.kind === "ever" && [...sym].every((x) => x === "thing:match" || x === "hypo" || x === "and")) {
    // "Did <team> ever play <team>", "<team>'s match against <team>, if they ever played": whether they met.
    stat = await beaten(t[0], t[1], null, scope);
  } else if (t.length === 1 && (p.award || sym.has("metric:award")) && [...sym].every((x) => /^metric:(?:award|win)$/.test(x))) {
    stat = await wonAward(t[0], p.award, scope);
  } else if (t.length === 1 && sym.has("metric:win") && (scope && !scope.bare ? !!p.eventKind || !!p.event : sym.has("thing:event")) && [...sym].every((x) => x === "metric:win" || x === "thing:event")) {
    // An event won: "won a championship", "won an event", "won <event>".
    stat = await wonAward(t[0], "Winner", scope, true);
  } else if (t.length === 1 && scope && !scope.bare && !sym.size) {
    stat = await attended(t[0], scope);
  }
  if (!stat) return null;
  // The yes or no is drawn above the card (SearchAnswer.verdict), never twice: the card keeps the evidence.
  const h = stat.headline!;
  const verdict = { answer: h.value as "Yes" | "No", label: h.sub ? `${h.label} · ${h.sub}` : h.label };
  stat = { ...stat, headline: undefined };
  const hits = (await Promise.all(t.map(async (x) => (await opts.resolve(String(x.number))).hits.find((h) => h.kind === "team" && h.ref === String(x.number))))).filter((h): h is NonNullable<typeof h> => !!h);
  return {
    q, hits: hits.map((h) => ({ ...h, facts: undefined, events: undefined })), pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label: stat.title }, verdict,
    ...(opts.full ? { stat } : { card: { kind: "info", title: stat.title, lines: [{ text: `${verdict.answer}: ${verdict.label}` }] } }),
    intent: { kind: `stat-${stat.intent}`, pattern: home ? "is [team] from [place]" : `${t.map(() => "[team]").join(" ")} ever ${stat.intent.slice(7)}${scope ? " [scope]" : ""}`, met: true, understood: [] },
  };
}
