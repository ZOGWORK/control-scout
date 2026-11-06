// The teams with a name said as words ("how many teams named <name>", "teams called <name> from <place>"): counted
// and listed, every one, by number, with where each is from to tell a shared name apart. A season said narrows to the
// teams that played that season; a place, to the teams from it. The count is always the list's length. None: said so,
// with the nearest names to try and a link to every team, never the no-match page.
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { all } from "../../db.js";
import { fold, names, type TeamName } from "../query/names.js";
import type { Parsed } from "../query/parse.js";
import { searchSeason } from "./season.js";

const plural = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "team" : "teams"}`;
const from = (t: TeamName) => [t.city, t.state, t.country === "USA" ? null : t.country].filter(Boolean).join(", ");

/** The season a time said names (null: every season), or undefined when the time is one no list of names takes (a
 *  window: teams aren't named by the week). */
function seasonOf(p: Parsed): number | null | undefined {
  const t = p.time;
  if (!t || t.kind === "ever") return null;
  if (t.kind === "window") return undefined;
  if (t.relative === "this") return searchSeason();
  if (t.relative === "last") return searchSeason() - 1;
  return t.season;
}

/** The answer for a parse with a name said as words, or null when it holds a slot a list of names doesn't take. */
export async function teamsNamedSearch(p: Parsed, opts: { full: boolean; pages: SearchPageLink[] }): Promise<SearchAnswer | null> {
  if (!p.named || p.teams.length || p.event || p.worlds || p.states || p.level || p.alliance || p.award || p.n != null) return null;
  const season = seasonOf(p);
  if (season === undefined) return null;
  const idx = await names();
  const place = p.place;
  const inPlace = (t: TeamName) => !place || (t.country === place.country && (place.state == null || t.state === place.state) && (place.city == null || fold(t.city ?? "") === fold(place.city)));
  let teams = idx.teamsNamed(p.named.words).filter(inPlace);
  if (season != null && teams.length) {
    const played = new Set((await all<{ team: number }>(`SELECT DISTINCT team FROM team_event_stats WHERE season = ? AND matches > 0 AND team IN (${teams.map(() => "?").join(",")})`, [season, ...teams.map((t) => t.number)])).map((r) => Number(r.team)));
    teams = teams.filter((t) => played.has(t.number));
  }
  teams = [...teams].sort((a, b) => a.number - b.number);
  // The name as the teams spell it, else as typed.
  const name = teams[0]?.name?.trim() || p.named.typed;
  const where = place ? ` ${place.kind === "city" ? "from" : "in"} ${place.name}` : "";
  const when = season != null ? ` that played in ${seasonLabel(season)}` : "";
  const scope = [...(place ? [place.name] : []), season != null ? seasonLabel(season) : "All seasons"];
  const title = `Teams named ${name}`;
  const blocks: StatAnswer["blocks"] = [];
  if (teams.length) {
    blocks.push({
      kind: "table", title: "By team number",
      columns: [{ key: "team", label: "Team" }, { key: "from", label: "From" }, { key: "last", label: "Last played" }],
      rows: teams.map((t) => ({ cells: { team: `${t.number} ${t.name ?? ""}`.trim(), from: from(t) || null, last: t.lastPlayed != null ? seasonLabel(t.lastPlayed) : "Not yet" }, href: `/teams/${t.number}` })),
    });
  } else {
    // The names to try instead: the one these words nearly spell, the names they're part of, and the name anywhere
    // when a place or a season narrowed it to none.
    const near = idx.nearTeam(p.named.words)?.name;
    const part = await all<{ name: string }>("SELECT DISTINCT name FROM teams WHERE LOWER(name) LIKE ? ORDER BY number LIMIT 4", [`%${p.named.words}%`]);
    const wider = (place || season != null) && idx.teamsNamed(p.named.words).length ? [`teams named ${p.named.typed}`] : [];
    const queries = [...new Set([...wider, ...(near ? [`teams named ${near}`] : []), ...part.map((r) => r.name.trim()).filter((n) => fold(n) !== fold(p.named!.words))])].slice(0, 4);
    if (queries.length) blocks.push({ kind: "related", title: "Did you mean", queries });
  }
  const stat: StatAnswer = {
    family: "aggregate", intent: "teams-named", title, scope,
    headline: { value: plural(teams.length), label: `named ${name}${where}${when}` },
    blocks,
    definition: "A team counts when its whole name is these words, capitals, accents and punctuation aside. Each team is listed once, by number, with where it's from.",
    source: season != null ? `Teams that played a match in ${seasonLabel(season)}` : "Every team on record, played or not",
    ...(teams.length ? {} : { none: `No team is named ${p.named.typed}${where}${when}.` }),
  };
  const label = `${title}${where}`;
  const browse = { title: "Browse all teams", href: "/teams" };
  return {
    q: p.q, hits: [], pages: [browse, ...opts.pages.filter((x) => x.href !== browse.href)], step: "deterministic", weak: false,
    understood: { kind: "question", label, ...(season != null ? { season } : {}) },
    ...(opts.full ? { stat } : { card: { kind: "info", title: label, lines: teams.slice(0, 8).map((t) => ({ text: `${t.number} ${t.name ?? ""}`.trim(), detail: from(t), href: `/teams/${t.number}` })), ...(teams.length ? {} : { none: stat.none }) } }),
    intent: { kind: "stat-teams-named", pattern: `teams named [name]${place ? " [place]" : ""}${season != null ? " [season]" : ""}`, met: true, understood: [] },
  };
}
