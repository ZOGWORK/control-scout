// A run of seasons asked of anything but a rank (search audit, "season ranges"): "highest score from <year> to <year>",
// "<team> highest score since <year>", "best record <season> to <season>". Each season is its own game, so each one is
// asked on its own, exactly as said for that season, and the answers stand side by side: never one number across them.
// Nothing here names a team, a season or a place: the parse reads them (time.ts `range`), the answer is the one search
// gives for each season.
import type { SearchAnswer, SearchPageLink } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { seasonLabel } from "../../../src/shared/format.js";
import { gameOf } from "../../data/seasons.js";
import type { Parsed } from "./parse.js";
import { seasonsOf } from "./seasons.js";

/** At most this many seasons are asked, the latest ones (each is a question of its own). */
export const MAX_SEASONS = 8;

const escRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A season's own words dropped from its answer's title, its years and its game's name ("Highest-scoring matches,
 *  <game>, <season>": "Highest-scoring matches"). */
const without = (title: string, s: number) => [seasonLabel(s), gameOf(s)].filter((w): w is string => !!w)
  .reduce((t, w) => t.replace(new RegExp(`\\s*(?:[,·]\\s*|\\bin\\s+)?${escRe(w)}`, "g"), ""), title).replace(/[\s,·]+$/, "").trim();

/** The run asked one season at a time by `ask` (the pipeline's own answer for that season), side by side; null when no
 *  season gets an answer of its own (left to search's other readers). */
export async function perSeasonAnswer(p: Parsed, opts: { full: boolean; pages: SearchPageLink[] }, ask: (p: Parsed) => Promise<SearchAnswer | null>): Promise<SearchAnswer | null> {
  const t = p.time;
  if (t?.kind !== "seasons" || !t.range || !p.intent) return null;
  const all = await seasonsOf(t.range);
  const seasons = all.slice(-MAX_SEASONS);
  if (seasons.length < 2) return null;
  const each = await Promise.all(seasons.map(async (s) => {
    const a = await ask({ ...p, time: { kind: "season", season: s, label: `in ${seasonLabel(s)}`, typed: t.typed } });
    // An answer that stepped to another season (nothing played in this one) is none for this one.
    const st = a?.stat && (a.understood?.season == null || a.understood.season === s) ? a.stat : null;
    return { s, a, st };
  }));
  const answered = each.filter((x) => x.st?.headline);
  if (!answered.length) return null;
  // The same answer whatever the season (one that doesn't read a season): never shown as a run.
  if (answered.length > 1 && answered.every((x) => x.st!.headline!.value === answered[0].st!.headline!.value && x.st!.headline!.label === answered[0].st!.headline!.label)) return null;
  const first = answered[0].st!;
  const what = without(first.title, answered[0].s);
  const run = t.label;
  // One team's run: the team named, as its own season's card does in its header.
  const team = p.teams.length === 1 ? (first.team ?? { number: p.teams[0].number, name: p.teams[0].name ?? null }) : null;
  const who = team && !what.includes(String(team.number)) ? `${team.name ? `${team.name} (${team.number})` : `Team ${team.number}`}: ` : "";
  const label = `${who}${what}, each season ${run}`;
  const read: SearchAnswer = {
    q: p.q, hits: [], pages: opts.pages, step: "deterministic", weak: false,
    understood: { kind: "question", label },
    intent: { kind: `stat-seasons-${first.intent}`, pattern: `[${p.intent}] [seasons]`, met: true, understood: [label] },
  };
  if (!opts.full) return { ...read, pages: [{ title: label, href: `/search?q=${encodeURIComponent(p.q)}` }, ...opts.pages] };
  const stat: StatAnswer = {
    family: first.family, intent: `seasons-${first.intent}`, title: label, ...(team ? { team } : {}),
    scope: [`${seasonLabel(seasons[0])} to ${seasonLabel(seasons[seasons.length - 1])}`, ...first.scope.filter((c) => !seasons.some((s) => c === seasonLabel(s)))],
    definition: `Each season is its own game, so each one is answered on its own, as it would be for that season alone: never one number across seasons.${all.length > seasons.length ? ` The latest ${MAX_SEASONS} seasons of the ${all.length} asked.` : ""} ${first.definition ?? ""}`.trim(),
    source: `Each season's own answer (${answered.length} of ${seasons.length} seasons with one)`,
    blocks: [
      { kind: "kpis", items: each.map((x) => ({ label: seasonLabel(x.s), value: x.st?.headline?.value ?? "—", sub: x.st?.headline ? (x.st.headline.label ?? "") : "Nothing yet", ...(x.st?.headline ? { tone: "accent" as const } : {}) })) },
      {
        kind: "table", title: `${what}, season by season`,
        columns: [{ key: "season", label: "Season" }, { key: "value", label: "Answer" }, { key: "detail", label: "Detail" }],
        rows: each.map((x) => ({
          cells: { season: seasonLabel(x.s), value: x.st?.headline?.value ?? null, detail: x.st?.headline ? [x.st.headline.label, x.st.headline.sub].filter(Boolean).join(" · ") : (x.st?.none ?? "No answer for this season") },
          ...(x.st?.headline?.href ? { href: x.st.headline.href } : {}),
        })),
      },
    ],
  };
  return { ...read, stat };
}
