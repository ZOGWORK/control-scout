// A question search can't answer yet, said so (owner brief 2026-11-06, §4): "Sorry — I can't answer that yet", what
// the question was read as (its team, event, place, time or name), and the searches that do answer about it, one tap
// each. Only when something was read: a query that names nothing real (a team that doesn't exist) keeps the plain
// no-match page. The failure is still filed by its pattern (server/searchFailures.ts): nothing here changes the label
// it reads, and nothing about the filing is shown.
import type { SearchAnswer } from "../../../src/shared/api.js";
import { describe, parseQuery } from "../query/parse.js";
import { parseContext } from "../query/context.js";
import { FALLBACK_NOTE } from "../searchLayers.js";
import { teamSuggestions } from "../searchCoverage.js";
import { hasTeamPage } from "../../../src/shared/teamPages.js";

/** The sorry note for an answer that didn't answer `q`, or null when it did, or when nothing in it was read. */
export async function sorryFor(q: string, a: SearchAnswer, opts: { now?: number; prefer?: ReadonlySet<string> } = {}): Promise<SearchAnswer["sorry"] | null> {
  const fallback = (a.understood?.label ?? "").includes(FALLBACK_NOTE);
  if (!fallback && !(a.step === "recovery" && !a.stat && !a.card)) return null;
  const p0 = await parseQuery(q, await parseContext(opts.now, opts.prefer));
  // A placeholder registration ("Off-Season Demo Team") is no team to suggest anything about, and a name several teams
  // share that nothing picked (no rule) is none of them: said as the shared name, never as one team.
  // As typed, without a possessive ("ultraviolet bots' …").
  const shared = p0.teams.filter((t) => t.candidates && !t.rule).map((t) => ({ ...t, typed: t.typed.replace(/['’]s?$/, "") }));
  const p = { ...p0, teams: p0.teams.filter((t) => hasTeamPage(t.number, t.name) && !(t.candidates && !t.rule)) };
  const read = [...describe(p).filter((x) => !x.startsWith("Intent: ")), ...shared.map((t) => `${t.typed}: ${t.candidates!.length} teams share the name`)];
  const team = p.teams[0]?.number ?? (fallback && !shared.length ? Number(a.hits.find((h) => h.kind === "team")?.ref ?? NaN) : NaN);
  if (!read.length && Number.isNaN(team)) return null;
  // The searches that answer about what was read: the team's own (as the team fallback offers them), else a place's,
  // an event's or a name's.
  const where = p.place?.name;
  const suggest = a.suggest?.length && !shared.length ? a.suggest
    // A team with no played season yet has no stat searches: its own page is the one that answers.
    : !Number.isNaN(team) ? await teamSuggestions(team, q).then((x) => x.length ? x : [String(team)])
    : shared.length ? shared.map((t) => `teams named ${t.typed}`)
    : where ? [`teams in ${where}`, `events in ${where}`, `top 10 teams in ${where}`]
    : p.event ? [`${p.event.typed} results`, `who won ${p.event.typed}`]
    : p.named ? [p.named.typed]
    : [];
  if (!read.length && !Number.isNaN(team)) read.push(`Team ${team}`);
  return { understood: read, suggest: suggest.slice(0, 4) };
}
