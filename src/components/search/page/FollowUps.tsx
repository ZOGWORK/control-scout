// A search's follow-ups (server/api/answers/followUps.ts), asked once its answer is on screen: People also ask (the
// next questions, each opening to its answer's line and a link that runs it), Related searches (short searches, one
// tap each) and the team's highlights. Each is a search answered directly, its numbers that answer's own, coloured as
// that answer's card colours them (search's palette). Plain rows and chips in the page's card style, nothing when
// there's nothing to offer. A wide screen
// has them in a column beside the answer; a phone, People also ask under it and Related searches at the end.
import { Link } from "react-router-dom";
import { ChevronDown, Clapperboard, Search } from "lucide-react";
import { useApi, qs } from "../../../lib/api";
import type { FollowUpTone, SearchFollowUp, SearchFollowUps } from "../../../shared/api";
import { SEARCH_PALETTE } from "../../../lib/textTones";
import { cn } from "../../cn";
import { PART } from "./TeamAnswer";
import { headlineTone } from "./StatAnswer";
import { lineSwatch } from "./FactCard";

const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;
const NONE: SearchFollowUps = { ask: [], related: [] };

/** A follow-up's number in its answer card's colour: a stat headline's, a card line's, a yes or no, a count. */
export function toneOf(t: FollowUpTone, value: string, rest: string): string {
  if ("stat" in t) return headlineTone({ ...t.stat, headline: { value, label: rest } }, t.stat.teams.map((number) => ({ number })));
  if ("card" in t) return lineSwatch(t.card, { text: value }).text;
  if ("verdict" in t) return SEARCH_PALETTE[t.verdict === "Yes" ? "yes" : "no"].text;
  return SEARCH_PALETTE.count.text;
}

/** A follow-up's line: its number in colour, then the rest. */
function Line({ x, className }: { x: SearchFollowUp; className?: string }) {
  return (
    <span className={cn("break-words", className)} data-preview>
      <span className={cn("font-semibold tabular-nums", toneOf(x.tone, x.value, x.rest))} data-value>{x.value}</span>
      {x.rest && <span className="text-muted-foreground"> · {x.rest}</span>}
    </span>
  );
}

/** The follow-ups for `q`, asked once `ready` (the answer on screen); none until then, and never another search's.
 *  `season`: the answer's picked season (./SeasonPick.tsx), which they're asked about too. */
export function useFollowUps(q: string, prefer: string | undefined, ready: boolean, season: number | null = null): SearchFollowUps {
  const { data } = useApi<SearchFollowUps & { q: string; season?: number }>(ready && q ? `/api/search/follow${qs({ q, prefer, season: season ?? undefined })}` : null);
  return data?.q === q && (data.season ?? null) === season ? data : NONE;
}

export function PeopleAlsoAsk({ ask, className }: { ask: SearchFollowUp[]; className?: string }) {
  if (!ask.length) return null;
  return (
    <section aria-label="People also ask" className={className} data-block="people-also-ask">
      <h2 className={PART}>People also ask</h2>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {ask.map((x) => (
          <details key={x.q} className="group">
            <summary className="flex min-h-[44px] cursor-pointer select-none list-none items-center gap-3 px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 flex-1 break-words">{x.q}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="px-4 pb-3 text-sm">
              <p className="text-foreground"><Line x={x} /></p>
              <Link to={searchHref(x.q)} className="mt-1 inline-flex min-h-[44px] items-center font-medium text-foreground underline underline-offset-2 hover:no-underline">See the full answer →</Link>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Short searches, one chip each: wrapped on a wide screen, one per line on a phone (none hidden off the side). */
export function RelatedSearches({ related, seeAll, className }: { related: SearchFollowUp[]; seeAll?: string; className?: string }) {
  if (!related.length) return null;
  return (
    <nav aria-label="Related searches" className={className} data-block="related-searches">
      <h2 className={PART}>Related searches</h2>
      <ul className="flex flex-wrap gap-2 max-sm:flex-col">
        {related.map((x) => (
          <li key={x.q} className="min-w-0">
            <Link to={searchHref(x.q)} title={x.preview} className="inline-flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-3.5 text-sm font-medium text-foreground hover:border-foreground/30 hover:bg-muted/50 max-sm:w-full">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 truncate">{x.q}</span>
            </Link>
          </li>
        ))}
      </ul>
      {seeAll && <Link to={`/related-searches?q=${encodeURIComponent(seeAll)}`} className="mt-2 inline-flex min-h-[44px] items-center text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline" data-see-all>See all related searches →</Link>}
    </nav>
  );
}

/** The team's standout matches, one link: what its highlights search answers, in a line. */
export function TeamHighlights({ h, className }: { h: SearchFollowUps["highlights"]; className?: string }) {
  if (!h) return null;
  return (
    <Link to={searchHref(h.q)} className={cn("flex min-h-[44px] items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:bg-muted/50", className)} data-block="team-highlights">
      <Clapperboard className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">View team {h.team}'s highlights →</span>
        <Line x={h} className="block" />
      </span>
    </Link>
  );
}

/** All three, for the column beside the answer. */
export function FollowUpsRail({ f, q }: { f: SearchFollowUps; q?: string }) {
  if (!f.ask.length && !f.related.length && !f.highlights) return null;
  return (
    <div className="space-y-5" data-rail="follow-ups">
      <TeamHighlights h={f.highlights} />
      <PeopleAlsoAsk ask={f.ask} />
      <RelatedSearches related={f.related} seeAll={q} />
    </div>
  );
}
