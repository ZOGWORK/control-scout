// New Jersey's conferences asked in search (src/shared/conferences.ts): a team's place in its conference ("4215
// conference ranking", "where does 4215 rank in East Bergen Conference"), a conference's table ("East Bergen Conference
// rankings", "best team in East Bergen Conference") and who won one ("who won East Bergen Conference"). The conference is
// found from the stored data (its name's words, FTC New Jersey's and FIRST's), never named here; the numbers are the
// league page's conference table's, so the answer and the page it links to always agree. The ranking is by league
// standing over the league meets only: never the tournament's. Who won comes from the awards, never the top seed.
import type { StatAnswer, StatBlock } from "../../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../../src/shared/format.js";
import { asGiven, asOfDate, CONFERENCE_LABEL, conferenceHref, ordinal, type Conference, type ConferenceRow } from "../../../../src/shared/conferences.js";
import { leagueTitle } from "../../../../src/shared/leagues.js";
import { all } from "../../../db.js";
import { allConferences, conferenceByEvent, teamConferenceEvent, tournamentRank } from "../../conferences.js";
import { readScope } from "../read.js";

export interface ConferenceAsk {
  /** The words that may name the conference (and, before them, a team), in order. */
  words: string[];
  team: number | null;
  season: number | null;
  /** "Last season": the season before the current one. */
  last: boolean;
  /** "This season": the current one. */
  now: boolean;
  /** "Who won …": the winning alliance, from the awards. */
  won: boolean;
}

const WON = /\b(?:who|which\s+teams?)\s+(?:won|wins|took|takes)\b|\bwinners?\b|\bchampions?\b|\bwon\b/;
const TABLE = /\b(?:rank(?:s|ed|ing|ings)?|standings?|leaderboard|table|top|best|strongest|leaders?|leading|first|1st|#1|number\s+one|position|place|placing|order)\b/;
/** An award's ask ("east bergen conference inspire winner") is the award readers', not this one. */
const AWARD = /\b(?:inspire|think|connect|motivate|innovate|design|control|reach|sustain|judges|dean'?s?|compass|award)\b/;
/** The ask's frame, never part of a conference's name. */
const FRAME = new Set(["the", "a", "an", "of", "in", "for", "at", "on", "is", "are", "was", "were", "what", "whats", "who", "whos", "which", "where", "wheres", "how", "does", "do", "did",
  "team", "teams", "show", "me", "current", "currently", "now", "this", "season", "year", "ftc", "nj", "new", "jersey", "and", "s", "my", "our", "its", "their", "all",
  "rank", "ranks", "ranked", "ranking", "rankings", "standing", "standings", "leaderboard", "table", "top", "best", "strongest", "leader", "leaders", "leading", "first", "1st", "#1",
  "number", "one", "position", "place", "placing", "order", "by", "league", "rs", "won", "win", "wins", "winner", "winners", "champion", "champions", "took", "take", "takes", "tournament",
  "please", "pls", "tell", "list", "see", "get", "stand", "stands", "sit", "sits", "finish", "finished", "go", "going", "into", "with", "to"]);

/** Lower case, punctuation out; a season's dash or slash ("2025-26", "2025/26") kept for the scope reader. */
const norm = (s: string) => s.toLowerCase().replace(/['’]/g, "").replace(/(\d)\s*([-–/])\s*(\d)/g, "$1$2$3").replace(/[^a-z0-9#\s\-–/]/g, " ").replace(/(^|\s)[-–/]+|[-–/]+(?=\s|$)/g, " ").replace(/\s+/g, " ").trim();

/** A conference ask, or null: it says "conference" and asks for a rank, a table or a winner (or names a team). */
export function readConferenceAsk(raw: string): ConferenceAsk | null {
  const q = ` ${norm(raw)} `;
  if (!/\bconf(?:erence)?s?\b/.test(q) || AWARD.test(q)) return null;
  const { scope, rest: said } = readScope(q);
  // A place in a ranking ("top 10", "#1", "number 2") is the table's ask, never a team's number.
  const rest = said.replace(/\b(?:top|best|first|leading)\s+\d{1,3}\b|(?:^|\s)#\s*\d{1,3}\b|\bnumber\s+\d{1,3}\b/g, " top ");
  const nums = (rest.match(/\b\d{1,6}\b/g) ?? []).map(Number);
  if (nums.length > 1) return null;
  const team = nums[0] ?? null;
  const won = WON.test(rest);
  if (!won && !TABLE.test(rest) && team == null) return null;
  // The words before "conference" may name it (and a team's name before that); the rest is frame.
  // A team "at" a named conference ("4215 rank at east bergen conference") asks about its tournament: the event
  // readers'. "In" it is the conference's. With no team, "at" names the conference ("top teams at …").
  const at = scope.at && /\bconf(?:erence)?s?\b/.test(scope.at) ? scope.at : null;
  if (team != null && at) return null;
  // "Essex/Union": two words of a name.
  const before = (at ?? rest).split(/\bconf(?:erence)?s?\b/)[0].replace(/([a-z])[/–-](?=[a-z])/g, "$1 ");
  const named = (t: string) => t.replace(/([a-z])[/–-](?=[a-z])/g, "$1 ").split(" ").filter((w) => w && !FRAME.has(w) && !/^\d+$/.test(w));
  const after = named((at ?? rest).split(/\bconf(?:erence)?s?\b/).slice(1).join(" "));
  // The name before "conference", else after it when a table or winner is asked ("conference rankings for east bergen").
  const lead = named(before);
  const words = lead.length ? lead : won || TABLE.test(rest) ? after : [];
  // A team and a conference's name with no rank or winner asked ("how did 4215 do at east bergen conference") is the
  // tournament's question; a team's number beside "conference" alone ("4215 conference") is this one.
  if (!won && !TABLE.test(rest) && words.length) return null;
  // Words after "conference" that aren't frame ("4215 conference schedule") ask something else about it.
  if (!won && !TABLE.test(rest) && after.length) return null;
  // A season after every stored one is kept, so the answer says it has none yet.
  const season = scope.future?.season ?? (scope.lastYear ? null : scope.season);
  return { words, team, season, last: !!scope.lastYear && season == null, now: scope.latest && season == null && !scope.lastYear, won };
}

type Stored = Awaited<ReturnType<typeof allConferences>>[number];
/** The latest season's of some editions. */
const latest = (l: Stored[]) => [...l].sort((a, b) => b.season - a.season)[0];
const tokens = (slug: string) => slug.split("-").filter((t) => t && t !== "conference");

/** The stored conferences the trailing words name, best first (a name said whole beats one it is part of), and the
 *  words before them (a team's name, when a team is asked by name). */
export function matchConference(words: string[], list: Stored[]): { hits: Stored[]; lead: string[] } {
  for (let n = words.length; n >= 1; n--) {
    const said = words.slice(words.length - n).map((w) => w.toLowerCase());
    const fit = (c: Stored) => Math.min(...c.aliases.map((a) => { const t = tokens(a); return said.every((w) => t.includes(w)) ? t.length - said.length : Infinity; }));
    const hits = list.filter((c) => fit(c) !== Infinity);
    if (hits.length) {
      const best = Math.min(...hits.map(fit));
      return { hits: hits.filter((c) => fit(c) === best), lead: words.slice(0, words.length - n) };
    }
  }
  return { hits: [], lead: words };
}

const rec = (r: ConferenceRow) => (r.wins == null || r.losses == null ? "—" : `${r.wins}-${r.losses}-${r.ties ?? 0}`);
const teams = (n: number) => `${n} team${n === 1 ? "" : "s"}`;
const who = (t: { team: number; name: string | null }) => `${t.team}${t.name ? ` ${t.name}` : ""}`;

/** The table, as the page's: league order, unranked teams last and said so, never an RS of 0. */
function tableBlock(c: Conference, team: number | null): StatBlock {
  return {
    kind: "table", title: `${c.name} · ${seasonLabel(c.season)} · ${CONFERENCE_LABEL}`,
    columns: [{ key: "team", label: "Team" }, { key: "rank", label: "Conf.", num: true }, { key: "league", label: "League", num: true }, { key: "rs", label: "RS", num: true }, { key: "tbp", label: "TBP", num: true }, { key: "wlt", label: "W-L-T" }, { key: "played", label: "Matches", num: true }, { key: "meets", label: "Meets", num: true }],
    rows: c.rows.map((r) => ({
      cells: { team: who(r), rank: r.rank != null ? r.rank : c.rs.kind === "gone" ? "Not available" : r.registered === "pending" ? "Waitlist" : r.registered ? "Registered" : "Not ranked yet", league: r.leagueRank != null ? `${r.leagueRank} of ${c.leagueOf}` : "—", rs: (asGiven(r.rs) ?? "—"), tbp: (asGiven(r.tbp) ?? "—"), wlt: rec(r), played: r.played ?? "—", meets: r.meets ?? "—" },
      href: `/teams/${r.team}?season=${c.season}`, strong: r.team === team,
    })),
  };
}

/** Where the league numbers come from, as the page says it. */
function sourceLine(c: Conference): string {
  const rs = c.rs;
  if (rs.kind === "snapshot") return `League RS as of ${asOfDate(rs.asOf)}, the week before the tournament.`;
  if (rs.kind === "final") return `Final league RS — league meets ended ${asOfDate(rs.lastMeet)}, before this tournament.`;
  if (rs.kind === "gone") return "The league standing these teams went in with is no longer available: a league meet came after the tournament.";
  return `League RS as of ${asOfDate(rs.asOf) ?? "the last read from FIRST"}.`;
}

const going = (c: Conference) => {
  const regs = c.teamsFrom === "registered" && c.registered ? `${teams(c.registered.count)} registered via FTC New Jersey, fetched ${asOfDate(c.registered.fetchedAt)}` : null;
  if (c.status === "upcoming") return regs ? `Tournament hasn't started yet — ${regs}. Registered, not the final field.` : "Tournament hasn't started yet.";
  // Past or under way with no team list from FIRST: the sign-ups are all there is, said so.
  return regs ? `FIRST hasn't posted this tournament's team list: these are the ${regs}, not its final field.` : "";
};

/** The next edition of a conference after `season` (a later season's tournament not finished yet), said in a line. */
async function nextOf(c: Stored, list: Stored[]): Promise<StatBlock | null> {
  const mine = new Set(c.aliases);
  const later = list.filter((o) => o.season > c.season && o.aliases.some((a) => mine.has(a)));
  // The earliest later season with exactly one edition (a season with two alias-sharing tournaments names neither).
  const seasons = [...new Set(later.map((o) => o.season))].sort((a, b) => a - b);
  const n = seasons.map((s) => later.filter((o) => o.season === s)).find((l) => l.length === 1)?.[0];
  if (!n) return null;
  const d = await conferenceByEvent(n.season, n.code);
  if (!d || d.status === "finished") return null;
  const regs = d.registered ? `, ${teams(d.registered.count)} registered via FTC New Jersey (fetched ${asOfDate(d.registered.fetchedAt)})` : d.teamsFrom === "field" ? `, ${d.rows.length} teams on FIRST's list` : "";
  return { kind: "links", title: `Next: ${d.name}, ${seasonLabel(d.season)}`, items: [{ label: `${asOfDate(d.start) ?? "Date to be set"} · ${leagueTitle(d.leagueName, d.league)}${regs}`, href: conferenceHref(d.season, d.region, d.league, { slug: d.slug }) }] };
}

const base = (season: number) => ({
  family: "leaderboard" as const, intent: "conference", scope: [seasonLabel(season), "New Jersey"], blocks: [] as StatBlock[],
  definition: `${CONFERENCE_LABEL} A conference's ranking is its tournament's teams in FIRST's league order (RS, then TBP, over the league meets), not the tournament's own ranking: those are two different rankings. Conferences are FTC New Jersey's; FIRST computes RS and TBP.`,
  source: `FIRST's ${seasonLabel(season)} league rankings and team lists; conference names from FTC New Jersey and FIRST's event names`,
});

/** The answer, or null when the words name no New Jersey conference and no team's conference. */
export async function conferenceAskAnswer(ask: ConferenceAsk, current: number): Promise<StatAnswer | null> {
  const list = await allConferences();
  if (!list.length) return null;
  const { hits, lead } = ask.words.length ? matchConference(ask.words, list) : { hits: [] as Stored[], lead: [] as string[] };
  const season = ask.last ? current - 1 : ask.now ? current : ask.season;
  // A team asked by name before the conference's ("where does hypnotic robotics rank in east bergen conference").
  let team = ask.team;
  if (team == null && lead.length) {
    // Two teams of that name: neither, never the lower number.
    const named = await all<{ number: number }>("SELECT number FROM teams WHERE lower(name) = ? ORDER BY number LIMIT 2", [lead.join(" ")]);
    if (named.length === 1) team = Number(named[0].number);
  }
  if (ask.words.length && !hits.length && team == null) return null;
  if (lead.length && team == null) return null;

  const finished = async (cands: Stored[]) => {
    for (const c of [...cands].sort((a, b) => b.season - a.season || (b.start ?? "").localeCompare(a.start ?? ""))) {
      const d = await conferenceByEvent(c.season, c.code);
      if (d && d.status === "finished") return { c, d };
    }
    return null;
  };

  // A team's conference place.
  if (team != null) {
    let pick: { season: number; code: string; registered: boolean; waitlist: boolean } | null = null;
    if (hits.length) {
      // That conference: the season asked, else the latest FIRST lists the team in it, else its latest sign-up.
      const named = [...hits].sort((a, b) => b.season - a.season).filter((c) => season == null || c.season === season);
      for (const registered of [false, true]) {
        for (const c of named) {
          const ev = await teamConferenceEvent(c.season, team);
          if (ev && ev.code === c.code && ev.registered === registered) { pick = { season: c.season, ...ev }; break; }
        }
        if (pick) break;
      }
    } else {
      const seasons = season != null ? [season] : [...new Set(list.map((c) => c.season))].sort((a, b) => b - a);
      // No season said: the latest one FIRST lists the team in a conference field, else its latest sign-up.
      for (const s of seasons) { const ev = await teamConferenceEvent(s, team); if (ev && !ev.registered) { pick = { season: s, ...ev }; break; } }
      if (!pick) for (const s of seasons) { const ev = await teamConferenceEvent(s, team); if (ev) { pick = { season: s, ...ev }; break; } }
    }
    // Re-read for the table: a sync between the two reads (FIRST's field replacing the sign-ups) can leave the team off
    // it, which is the not-on-the-list answer, never a crash.
    const got = pick ? await conferenceByEvent(pick.season, pick.code) : null;
    const mine = got?.rows.find((x) => x.team === team);
    if (!pick || !got || !mine) {
      const S = season ?? current;
      // The conference's name in the season asked (else its latest), never another season's.
      const asked = season != null ? hits.filter((c) => c.season === season) : [];
      if (season != null && hits.length && !asked.length) return { ...base(S), title: `${latest(hits).name} · ${seasonLabel(S)}`, none: `No New Jersey conference by that name in ${seasonLabel(S)}.` };
      const named = hits.length ? latest(asked.length ? asked : hits).name : null;
      const [t] = await all<{ name: string | null; state: string | null }>("SELECT name, state FROM teams WHERE number = ?", [team]);
      if (!t) return null;
      return { ...base(S), title: `${team}'s conference`, team: { number: team, name: t.name },
        none: named ? `${team} isn't on ${named}'s team list${season != null ? ` in ${seasonLabel(S)}` : ""}. A conference ranking is its tournament's teams by league standing.`
          : (t.state ?? "").toUpperCase() !== "NJ" ? `${team} isn't a New Jersey team: conferences are New Jersey's alone.`
          : `${team} isn't on any New Jersey conference tournament's team list${season != null ? ` in ${seasonLabel(S)}` : ""} yet.` };
    }
    const d = got;
    const r = mine;
    const S = seasonLabel(d.season);
    const href = conferenceHref(d.season, d.region, d.league, { slug: d.slug, team });
    const tRank = d.status !== "upcoming" && d.teamsFrom === "field" ? await tournamentRank(d.season, d.code, team) : null;
    // From the re-read: a sync may have put FIRST's field in place of the sign-ups.
    // The phase from the tournament's status (going in until it starts), the sign-up wording from where the list came from.
    const goingIn = d.status === "upcoming";
    const reg = d.teamsFrom === "registered";
    const waitlist = reg && r.registered === "pending";
    const sub = [r.leagueRank != null ? `League rank ${r.leagueRank} of ${d.leagueOf}` : null, r.rs != null ? `RS ${(asGiven(r.rs) ?? "—")}` : null, r.tbp != null ? `TBP ${(asGiven(r.tbp) ?? "—")}` : null,
      r.played != null ? `${r.played} played` : null, r.meets != null ? `${r.meets} meet${r.meets === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
    const blocks: StatBlock[] = [
      { kind: "kpis", items: [
        { label: waitlist ? "Waitlist, by league RS" : goingIn ? "Going in, by league RS" : "Conference rank", value: r.rank != null ? `${ordinal(r.rank)} of ${d.rows.length}` : d.rs.kind === "gone" ? "Not available" : "Not ranked yet", sub: r.rank != null ? `by league RS, ${d.name}` : d.rs.kind === "gone" ? "the going-in standing can't be read any more" : "no league meets played", href, tone: "accent" },
        { label: "League rank", value: r.leagueRank != null ? `${r.leagueRank} of ${d.leagueOf}` : "—", sub: leagueTitle(d.leagueName, d.league) },
        { label: "RS", value: (asGiven(r.rs) ?? "—"), sub: `TBP ${(asGiven(r.tbp) ?? "—")}` },
        { label: "League meets", value: r.meets != null ? String(r.meets) : "—", sub: r.played != null ? `${r.played} matches` : undefined },
      ] },
      tableBlock(d, team),
      { kind: "links", title: "Full conference table", items: [{ label: `${d.name} · ${S}`, href, sub: `${leagueTitle(d.leagueName, d.league)} · ${CONFERENCE_LABEL}` }] },
    ];
    const notes = [sourceLine(d), going(d), tRank != null && r.rank != null ? `At the tournament itself ${team} ranked ${ordinal(tRank)}: a different ranking from the league's.` : ""].filter(Boolean).join(" ");
    return {
      ...base(d.season), title: goingIn ? `${team} going into ${d.name} · ${S}` : `${team} in ${d.name} · ${S}`, team: { number: team, name: r.name },
      headline: { value: r.rank != null ? `${ordinal(r.rank)} of ${d.rows.length}` : d.rs.kind === "gone" ? "Not available" : "Not ranked yet",
        label: `${who(r)} ${waitlist ? "is on the waitlist for" : reg && goingIn ? "is registered for" : goingIn ? "is going into" : "in"} ${d.name}, ${leagueTitle(d.leagueName, d.league)}, ${S}, by league RS`, sub: [sub, CONFERENCE_LABEL].filter(Boolean).join(" · "), href },
      definition: `${base(d.season).definition} ${notes}`, blocks,
    };
  }

  // No team and no conference named: which conference? The latest season's winners, never a guess.
  if (!hits.length) {
    const seasons = [...new Set(list.map((c) => c.season))].sort((a, b) => b - a);
    for (const s of season != null ? [season] : seasons) {
      const ds = (await Promise.all(list.filter((c) => c.season === s).map((c) => conferenceByEvent(c.season, c.code)))).filter((d): d is NonNullable<typeof d> => !!d);
      const done = ds.filter((d) => d.status === "finished" && d.winner);
      // With no season said: the latest season with a winner on record for "who won", else the latest with conferences.
      if (season == null && (ask.won ? !done.length : !ds.length)) continue;
      if (!ds.length) return { ...base(s), title: `New Jersey's conferences · ${seasonLabel(s)}`, none: `No New Jersey conference tournaments are listed for ${seasonLabel(s)}.` };
      return { ...base(s), title: `Which conference? New Jersey's conferences · ${seasonLabel(s)}`,
        none: !ask.won || done.length ? undefined : `No New Jersey conference tournament has been won in ${seasonLabel(s)} yet.`,
        blocks: [{ kind: "links", title: ask.won ? `Which conference? Each New Jersey conference's winner, ${seasonLabel(s)}` : `Which conference? New Jersey's conferences, ${seasonLabel(s)}`,
          // Every conference that season, each one's winner or where it stands, so any can be picked.
          items: ds.map((d) => ({ label: `${d.name}: ${d.winner ? `won by ${who(d.winner.captain)}${d.winner.picks.length ? ` with ${d.winner.picks.map(who).join(", ")}` : ""}`
            : d.status === "finished" ? "no winner on record yet" : d.status === "live" ? "under way" : "not played yet"}`, href: conferenceHref(d.season, d.region, d.league, { slug: d.slug }), sub: `${asOfDate(d.start) ?? ""} · ${leagueTitle(d.leagueName, d.league)}` })) }] };
    }
    return null;
  }

  // A conference's table, or who won it: the season asked, else the latest finished one (the next one said in a line).
  const pickC = season != null ? hits.filter((c) => c.season === season) : hits;
  if (!pickC.length) return { ...base(season!), title: `${latest(hits).name} · ${seasonLabel(season!)}`, none: `No New Jersey conference by that name in ${seasonLabel(season!)}.` };
  // Two conferences the words fit equally in one season: which one, never a guess.
  const bySeason = new Map<number, Stored[]>();
  for (const c of pickC) bySeason.set(c.season, [...(bySeason.get(c.season) ?? []), c]);
  // With no season said, a season the words fit twice is passed over while another fits once; asked, it's "which?".
  const clear = [...bySeason.values()].filter((l) => l.length === 1).flat();
  // The latest such season's, never the oldest.
  const ambiguous = season == null && clear.length ? undefined : [...bySeason.entries()].sort((a, b) => b[0] - a[0]).map(([, l]) => l).find((l) => l.length > 1);
  if (season == null && clear.length) pickC.splice(0, pickC.length, ...clear);
  if (ambiguous) {
    return { ...base(ambiguous[0].season), title: "Which conference?", blocks: [{ kind: "links", title: `Which conference? More than one is called "${ask.words.join(" ")}"`,
      items: ambiguous.map((c) => ({ label: `${c.name} · ${seasonLabel(c.season)}`, href: conferenceHref(c.season, c.region, c.league, { slug: c.slug }), sub: `${leagueTitle(c.leagueName, c.league)}` })) }] };
  }
  const got = season != null ? { c: pickC[0], d: await conferenceByEvent(pickC[0].season, pickC[0].code) } : (await finished(pickC)) ?? (() => {
    const c = [...pickC].sort((a, b) => b.season - a.season)[0];
    return { c, d: null as null | Awaited<ReturnType<typeof conferenceByEvent>> };
  })();
  // A sync may have dropped the conference since the list was read: no answer, never a crash.
  const d = got.d ?? (await conferenceByEvent(got.c.season, got.c.code));
  if (!d) return null;
  const S = seasonLabel(d.season);
  const href = conferenceHref(d.season, d.region, d.league, { slug: d.slug });
  const next = season == null ? await nextOf(got.c, list) : null;
  const tail = [next].filter((b): b is StatBlock => !!b);

  if (ask.won) {
    if (!d.winner) {
      return { ...base(d.season), title: `Who won ${d.name} · ${S}`, none: d.status === "finished"
        ? `No winner is on record yet for ${d.name} ${S}: FIRST hasn't posted the tournament's awards.`
        : d.status === "live" ? `${d.name} ${S} is under way: no winner yet.`
        : `${d.name} ${S} hasn't been won yet: it's on ${asOfDate(d.start) ?? "a date to be set"}. ${going(d)}`.trim(), blocks: [tableBlock(d, null), ...tail] };
    }
    const w = d.winner;
    return { ...base(d.season), title: `Who won ${d.name} · ${S}`, family: "awards",
      headline: { value: String(w.captain.team), label: `${who(w.captain)}, Winning Alliance Captain, ${d.name} ${S}`, sub: `${w.picks.length ? `with ${w.picks.map(who).join(", ")} · ` : ""}from FIRST's awards, not the top seed`, href: `/events/${d.season}/${encodeURIComponent(d.code)}` },
      definition: `Who won a conference is its tournament's winning alliance, from FIRST's awards (Winning Alliance captain and picks), never the qualification rank 1.`,
      blocks: [{ kind: "links", title: "The tournament and the conference table", items: [{ label: d.event, href: `/events/${d.season}/${encodeURIComponent(d.code)}`, sub: asOfDate(d.start) ?? "" }, { label: `${d.name} by league standing`, href, sub: CONFERENCE_LABEL }] }, ...tail] };
  }

  const top = d.rows.find((r) => r.rank === 1);
  return {
    ...base(d.season), title: `${d.name} rankings · ${S}`,
    ...(top ? { headline: { value: `#1 ${top.team}`, label: d.status === "upcoming" ? `${who(top)} is first going into ${d.name} by league RS, ${S}` : `${who(top)} leads ${d.name} by league RS, ${S}`, sub: `RS ${(asGiven(top.rs) ?? "—")} · TBP ${(asGiven(top.tbp) ?? "—")} · ${top.meets ?? 0} meets · ${CONFERENCE_LABEL}`, href } } : {}),
    definition: `${base(d.season).definition} ${sourceLine(d)} ${going(d)}`.trim(),
    blocks: [tableBlock(d, null), { kind: "links", title: "Full conference table", items: [{ label: `${d.name} · ${S}`, href, sub: `${leagueTitle(d.leagueName, d.league)} · ${CONFERENCE_LABEL}` }] }, ...tail],
  };
}
