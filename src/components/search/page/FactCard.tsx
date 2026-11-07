// A plain answer on /search: a team's listing facts ("where is 4215 from", "4215 sponsors and school",
// server/api/searchCoverage.ts teamFactAnswer) and every records card with no chart of its own (Worlds or states
// trips none found, awards, next event or match, high scores, a rule, a definition). One card in the team page's
// treatment (./TeamAnswer.tsx): the team's header, the answer as big bold values with their names under them (every
// sponsor its own row, values exactly as FIRST lists them), then the team's season at a glance and its events from
// the team page's own data, so a one-line answer still has its detail. Optional fields a newer server adds to a fact
// (`detail`, `link`) show when they're there.
import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, CalendarDays, Globe, GraduationCap, Handshake, Info, MapPin, Medal, Sparkles, Trophy, type LucideIcon } from "lucide-react";
import type { SearchCard, SearchCardFact, SearchCardLine } from "../../../shared/api";
import { StatTile, type Tone } from "../../StatTile";
import { TeamTable } from "../TeamTable";
import { cn } from "../../cn";
import { AnswerVideo } from "./AnswerVideo";
import { SEARCH_PALETTE, meaningOf, type Meaning } from "../../../lib/textTones";
import { ResultPill, RichText, TEAM_BAR, TEAM_SWATCH, TEAM_TEXT, type Swatch } from "./answerCells";
import { AnswerFrame, PART, RelatedQuestions, SeasonEvents, SeasonTiles, TAP, repeats, statedSeason, useAnswerSeason, useTeamProfile } from "./TeamAnswer";

/** What a card is, as its subtitle: which records it read. */
const SOURCE: Partial<Record<SearchCard["kind"], string>> = {
  worlds: "From the team's recorded FIRST Championship events, all seasons",
  states: "From the team's recorded state and regional championships, all seasons",
  awards: "From FIRST's award lists, all seasons",
  "event-awards": "From FIRST's award list for the event",
  wins: "From the team's recorded event results",
  "next-event": "From FIRST's event schedule",
  "next-match": "From the posted match schedule",
  "high-scores": "From scored matches",
  rule: "From the game manual",
};

/** Each card kind's colour (search's palette, the owner's brief 11-06: nothing grey for data), for whatever on it has
 *  no meaning of its own: a one-team card's records in the team hue, a schedule in it too (cyan, Upcoming's, sits too
 *  close to team A on the same card), a how-many's number in Count's amber, a rule or a definition in Reference's sky.
 *  Every kind is listed, so a new one can't be added without a colour (answerAudit.test.tsx draws each one). */
export const CARD_MEANING: Record<SearchCard["kind"], Meaning | "team"> = {
  worlds: "team", states: "team", "next-event": "team", "next-match": "team",
  wins: "winning", awards: "judged", "event-awards": "judged",
  "high-scores": "count", leaderboard: "team", rule: "reference", info: "reference",
};

/** A line that starts with its number: the number, then the rest of the sentence. */
const COUNT = /^(\d[\d,.]*)(\s.*)?$/;

/** A line's colour: an award's own on an awards card, Count's when a general answer's line is a number ("578 teams
 *  registered in Canada"), else the card kind's. */
export function lineSwatch(kind: SearchCard["kind"], line: Pick<SearchCardLine, "text">): Swatch {
  const award = kind === "awards" || kind === "event-awards" || kind === "wins" ? meaningOf(line.text) : null;
  const m = award ?? (kind === "info" && COUNT.test(line.text) ? "count" : CARD_MEANING[kind]);
  return m === "team" ? TEAM_SWATCH[0] : SEARCH_PALETTE[m];
}

const ICON: Partial<Record<SearchCard["kind"], LucideIcon>> = { rule: BookOpen, "next-event": CalendarDays, "next-match": CalendarDays, awards: Medal, "event-awards": Medal, info: Info };

/** Fields a newer server adds to a team's fact card (s260-facts): the season its numbers are from, and the rest of the
 *  team's card beyond what `facts` shows (region, record, OPR, rating, reliability). Read defensively. */
type CardExtra = SearchCard & { season?: number; support?: SearchCardFact[] };

/** The team page tiles already show a season's record, OPR and rating (from the team page's own data): those
 *  support facts aren't drawn twice. */
const ON_TILES = /^(record|opr|rating)\b/i;

/** `season`: the season the query named (its team hit's linkSeason); the card's own season wins, then one its title
 *  states, else the default. */
export function FactCard({ card, heading, season: asked }: { card: CardExtra; heading?: string; season?: number | null }) {
  const team = card.team;
  const season = useAnswerSeason(card.season ?? asked ?? statedSeason(card.title));
  const support = (card.support ?? []).filter((f) => !ON_TILES.test(f.label) && !card.facts?.some((x) => x.label === f.label));
  const profile = useTeamProfile(team?.number, season);
  const facts = card.facts ?? [];
  // A fact answer's lines are the dropdown's short form of the same facts: drawn once, as the facts.
  const lines = facts.length ? [] : card.lines;
  return (
    <AnswerFrame teams={team ? [team] : undefined} profile={profile} season={team ? season : null} title={card.title} hideTitle={repeats(heading, card.title) || (facts.length === 1 && facts[0].label === card.title)}
      sub={facts.length ? "As FIRST's team listing gives it" : SOURCE[card.kind]} data={{ "data-fact-card": facts.length ? "" : undefined, "data-card-kind": card.kind }}>
      {!!card.count && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile tone="neutral" icon={ICON[card.kind] ?? Trophy} label={card.title} chip={SEARCH_PALETTE.count.fill} className={cn("border-l-[6px]", SEARCH_PALETTE.count.edge, SEARCH_PALETTE.count.tint)}
            value={<span className={SEARCH_PALETTE.count.text} data-kpi>{card.count}</span>} hint={card.count === 1 ? "time" : "times"} />
        </div>
      )}
      {!!facts.length && <FactTiles facts={facts} />}
      {card.none && (
        // Nothing found is the answer "no": No's slate, a thick bar and a filled chip.
        <p className={cn("flex items-start gap-3 rounded-xl border border-l-[6px] border-border px-4 py-3 text-sm font-semibold text-foreground", SEARCH_PALETTE.no.edge, SEARCH_PALETTE.no.tint)} data-none>
          <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", SEARCH_PALETTE.no.fill)} data-line-icon><Info className="size-4" aria-hidden /></span><span className="mt-1">{card.none}</span>
        </p>
      )}
      {card.table?.rows.length ? <TeamTable table={card.table} label={card.title} />
        : !!lines.length && <Lines lines={lines} kind={card.kind} icon={ICON[card.kind] ?? Info} />}
      <AnswerVideo />
      {!!card.none && !!card.closest?.length && (
        <div className="mt-4"><h3 className={PART}>Closest records</h3><Lines lines={card.closest} kind={card.kind} /></div>
      )}
      {!!support.length && (
        <section aria-label="More about the team" className="mt-5" data-support>
          <h3 className={PART}>More about the team</h3>
          <FactTiles facts={support} />
        </section>
      )}
      {team && (
        <div className="mt-5">
          <SeasonTiles profile={profile} season={season} />
          <SeasonEvents profile={profile} season={season} />
        </div>
      )}
      <RelatedQuestions queries={card.related ?? []} />
    </AnswerFrame>
  );
}

/** A listed website as a link: FIRST lists some with no scheme ("www.example.org"); only http(s) ever links. */
export function hrefOf(raw: string): string | null {
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch { return null; }
}

/** Each fact's icon, by what it is; the tile in the team's hue (FactTiles: its chip filled, a thick bar). */
function factLook(label: string): [LucideIcon, Tone] {
  if (/where|location|from|city|home/i.test(label)) return [MapPin, "neutral"];
  if (/school|organi[sz]ation/i.test(label)) return [GraduationCap, "neutral"];
  if (/sponsor/i.test(label)) return [Handshake, "neutral"];
  if (/web|site/i.test(label)) return [Globe, "neutral"];
  if (/rookie|founded|since/i.test(label)) return [Sparkles, "neutral"];
  return [Info, "neutral"];
}

/** The facts as the team page's tiles: the value big and bold, its name above, a note under; several values (the
 *  sponsors) a row each. */
function FactTiles({ facts }: { facts: SearchCardFact[] }) {
  return (
    <div className={cn("grid gap-3", facts.length > 1 && "sm:grid-cols-2")} data-facts>
      {facts.map((f) => {
        const [icon, tone] = factLook(f.label);
        const many = f.values.length > 1;
        if (icon === MapPin && f.values.length === 1) return <div key={f.label} data-fact={f.label} className="min-w-0 sm:col-span-2"><LocationTile f={f} /></div>;
        return (
          <div key={f.label} data-fact={f.label} className="min-w-0">
            <StatTile tone={tone} icon={icon} chip={TEAM_SWATCH[0].fill} className={cn("border-l-[6px]", TEAM_SWATCH[0].edge, TEAM_SWATCH[0].tint)}
              label={<>{f.label}{many ? ` · ${f.values.length}` : ""}</>}
              value={<span className={cn("block break-words text-2xl leading-snug", TEAM_TEXT)}>{many
                ? f.values.map((v) => <span key={v} className="block border-t border-border/60 py-1 text-lg first:border-t-0 first:pt-0">{v}</span>)
                : <FactValue f={f} />}</span>}
              hint={f.detail} />
          </div>
        );
      })}
    </div>
  );
}

/** Where a team is from, drawn as a place: a map-like grid with a pin, the place big, and its parts (city, state or
 *  province, country) as FIRST lists them, each its own chip. Decorative drawing only: the place is the text. The pin and
 *  the place in the team's hue (the search results guide: hue means team, and this card is one team's). */
function LocationTile({ f }: { f: SearchCardFact }) {
  const v = f.values[0] ?? "";
  const parts = v.split(",").map((x) => x.trim()).filter(Boolean);
  // Named only when all three are there: a missing part is dropped before FIRST's fields are joined, so two parts
  // could be city and country or state and country. Otherwise the chips go unnamed.
  const names = parts.length === 3 ? ["City", "State", "Country"] : [];
  return (
    <div className={cn("relative isolate overflow-hidden rounded-xl border border-l-[6px] border-border p-4", TEAM_SWATCH[0].edge, TEAM_SWATCH[0].tint)} data-location>
      <svg className="absolute inset-y-0 right-0 -z-10 h-full w-2/3 text-foreground/10 max-sm:w-full max-sm:opacity-60" viewBox="0 0 200 120" preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs><pattern id="cs-loc-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="currentColor" strokeWidth="1" /></pattern></defs>
        <rect width="200" height="120" fill="url(#cs-loc-grid)" />
        <path d="M0 86 C40 70 70 96 110 78 S170 50 200 62" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="150" cy="56" r="34" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="150" cy="56" r="18" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className="flex items-center gap-2 text-sm leading-tight text-muted-foreground">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", TEAM_SWATCH[0].fill)} data-line-icon><MapPin className="size-4" aria-hidden /></span>{f.label}
      </span>
      <span className="mt-3 flex items-center gap-3">
        <span className={cn("grid size-12 shrink-0 place-items-center rounded-full text-background shadow-sm", TEAM_BAR)} aria-hidden><MapPin className="size-6" /></span>
        <span className={cn("min-w-0 break-words font-display text-3xl font-semibold leading-tight max-sm:text-2xl", TEAM_TEXT)}>{v || <span className="text-base font-normal text-muted-foreground">Not in FIRST's listing</span>}</span>
      </span>
      {parts.length > 1 && (
        <span className="mt-3 flex flex-wrap gap-1.5" data-location-parts>
          {parts.map((x, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-border bg-card/80 px-2.5 py-0.5 text-xs text-foreground">
              {names[i] && <span className="text-muted-foreground">{names[i]}</span>}<b className="font-semibold">{x}</b>
            </span>
          ))}
        </span>
      )}
      {f.detail && <span className="mt-2 block break-words text-xs text-muted-foreground">{f.detail}</span>}
    </div>
  );
}

function FactValue({ f }: { f: SearchCardFact }) {
  const v = f.values[0];
  if (v == null) return <span className="text-base font-normal text-muted-foreground">Not in FIRST's listing</span>;
  const href = f.link ? hrefOf(v) : null;
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="hover:underline">{v}</a> : <>{v}</>;
}

/** A card's records, a row each, in the line's colour (lineSwatch): a thick bar down its left on a wash of it, its icon
 *  a filled chip, what it is in bold in the colour (a link where it opens something; a count's number big), when and
 *  where under it, how it went as small stat pills. */
/** A word's explainer drawn inside another answer's card (a team's stat with what the stat means under it): its
 *  title as a part heading, its lines as a definition card's, so the page keeps one answer card. */
export function ExplainerLines({ card }: { card: Pick<SearchCard, "title" | "lines" | "kind"> }) {
  return (
    <section aria-label={card.title} className="mt-5" data-explainer>
      <h3 className={PART}>{card.title}</h3>
      <Lines lines={card.lines} kind={card.kind} icon={ICON[card.kind] ?? Info} />
    </section>
  );
}

function Lines({ lines, kind, icon: Icon }: { lines: SearchCardLine[]; kind: SearchCard["kind"]; icon?: LucideIcon }) {
  return (
    <ul className="space-y-2" data-lines>
      {lines.map((l, i) => {
        const sw = lineSwatch(kind, l);
        const n = sw === SEARCH_PALETTE.count ? COUNT.exec(l.text) : null;
        const body = (
          <>
            {Icon && <span className={cn("mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg", sw.fill)} data-line-icon><Icon className="size-5" aria-hidden /></span>}
            <span className="min-w-0 flex-1">
              <span className={cn("block break-words font-semibold group-hover:underline", sw.text, n && "font-display text-lg leading-snug sm:text-xl")} data-line-text>
                {n ? <><span className={cn("text-2xl tabular-nums sm:text-3xl", sw.text)} data-kpi>{n[1]}</span>{n[2]}</> : l.text}
              </span>
              {l.detail && <span className="mt-0.5 block text-xs text-muted-foreground"><RichText text={l.detail} /></span>}
              {!!l.results?.length && (
                <span className="mt-2 flex flex-wrap gap-1.5" data-results>
                  {l.results.map((r, j) => <ResultPill key={j} text={r} />)}
                </span>
              )}
            </span>
            {l.href && <ArrowRight className={cn("mt-1 size-5 shrink-0", sw.text)} aria-hidden />}
          </>
        );
        const cls = cn("group flex min-h-[44px] items-start gap-3 rounded-xl border border-l-[6px] border-border px-3.5 py-3", sw.edge, sw.tint);
        return (
          <li key={i}>
            {!l.href ? <div className={cls}>{body}</div>
              : /^https?:\/\//.test(l.href) ? <a href={l.href} target="_blank" rel="noopener noreferrer" className={cn(cls, TAP)}>{body}</a>
              : <Link to={l.href} className={cn(cls, TAP)}>{body}</Link>}
          </li>
        );
      })}
    </ul>
  );
}
