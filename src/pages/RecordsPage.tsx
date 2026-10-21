// /teams and /matches: a season's records, every team-event, team season or
// match, filtered, sorted, compared and exported (FTC Scout's records pages,
// plus Control Scout's prediction stats, saved filters and preset chips).
import { useLayoutEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BookUser, CalendarDays, Swords, Users } from "lucide-react";
import { useCurrentSeason, usePredictable, useTitle } from "../lib/meta";
import { seasonLabel } from "../lib/format";
import { PageHeader } from "../components/page";
import { RecordsTable } from "../components/records/RecordsTable";
import { TeamDirectory } from "../components/records/TeamDirectory";
import { cn } from "../components/cn";
import { revealInStrip } from "../lib/revealInStrip";
import { smoothBehavior } from "../lib/pageScroll";

type View = "events" | "season" | "listed" | "matches";

const TEAM_COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr", "totalPointsNpAvg", "totalPointsNpMax", "rank", "rp", "qualMatchesPlayed", "predictedWinPctAvg", "advancementOdds"];
const SEASON_COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr", "totalPointsNpAvg", "totalPointsNpMax", "events", "qualMatchesPlayed", "wins", "losses", "ties", "predictedWinPctAvg"];
const MATCH_COLS = ["redTotalPoints", "blueTotalPoints", "winningMargin", "highScore", "redAutoPoints", "blueAutoPoints", "redDcPoints", "blueDcPoints", "redEndgamePoints", "blueEndgamePoints", "redPredictedWinPct"];

export default function RecordsPage({ matches }: { matches?: boolean }) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const viewParam = sp.get("view");
  const view: View = matches ? "matches" : viewParam === "season" ? "season" : viewParam === "listed" ? "listed" : "events";
  const predictable = usePredictable(season);
  useTitle(matches ? `Match records ${seasonLabel(season)}` : view === "listed" ? `Team directory ${seasonLabel(season)}` : `Team records ${seasonLabel(season)}`);

  // Switching view starts the table afresh (a filter's stats differ per table), keeping the season.
  const hrefFor = (v: View) => {
    const q = new URLSearchParams();
    if (season !== current) q.set("season", String(season));
    if (v === "season" || v === "listed") q.set("view", v);
    // A country (from the home page's atlas) stays on across the team views.
    const country = sp.get("country");
    if (country && v !== "matches") q.set("country", country);
    return { pathname: v === "matches" ? "/matches" : "/teams", search: q.toString() ? `?${q}` : "" };
  };
  // On a phone the strip scrolls sideways: the current view is brought into it on arrival and on every change.
  // It jumps there on arrival and glides on a change the reader made.
  const strip = useRef<HTMLElement>(null);
  // The view the strip last showed (undefined before the first): the same view again (a replayed effect) is an arrival.
  const stripView = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const reveal = (behavior: ScrollBehavior = "auto") => {
      const el = strip.current?.querySelector<HTMLElement>("[aria-current=page]");
      if (strip.current && el) revealInStrip(strip.current, el, 8, behavior);
    };
    const arriving = stripView.current === undefined || stripView.current === view;
    stripView.current = view;
    reveal(arriving ? "auto" : smoothBehavior());
    // Again once the web fonts are in (they change the labels' widths), on arrival only: after a view change the
    // fonts are long in, and an instant correction there would cut the glide short. And whenever the strip's
    // width changes (a phone turned to portrait, a narrowed window) so the current view never ends up clipped.
    let live = true;
    if (arriving) document.fonts?.ready.then(() => { if (live) reveal(); });
    const widthNow = () => strip.current?.getBoundingClientRect().width;
    let width = widthNow();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const w = widthNow();
      if (w === width) return;
      width = w;
      reveal();
    });
    if (strip.current) ro?.observe(strip.current);
    return () => { live = false; ro?.disconnect(); };
  }, [view]);
  const setSeason = (s: number) => {
    // Keep the filter when only the season changes: the same stats exist every season.
    const q = new URLSearchParams(sp);
    q.set("season", String(s));
    q.delete("page");
    // Regions and dates belong to one season; the filter, sort, columns and country carry over.
    for (const k of ["region", "from", "to"]) q.delete(k);
    navigate({ pathname, search: `?${q.toString()}` });
  };

  const views: { v: View; label: string; icon: typeof Users; hint: string }[] = [
    { v: "events", label: "Team-events", icon: CalendarDays, hint: "One row per team per event" },
    { v: "season", label: "Team seasons", icon: Users, hint: "One row per team (best event OPR)" },
    { v: "listed", label: "All listed", icon: BookUser, hint: "Every team registered for the season, results or not" },
    { v: "matches", label: "Matches", icon: Swords, hint: "One row per played match" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">{view === "listed" ? "Directory" : "Records"} · {seasonLabel(season)}</span>}
        title={matches ? "Match records" : "Teams"}
        description={matches
          ? "Every played match of the season: filter by score, margin, phase or event, sort any column, export it."
          : view === "listed"
            ? "Every team registered for the season, whether or not it has played yet. Browse by country, open a profile, track a team."
            : "Every team's numbers for the season. Filter with any stat, sort any column, tick teams to compare, export to CSV."}
        phoneDescription={matches ? "Every played match of the season." : view === "listed" ? "Every team registered for the season." : "Every team's numbers for the season."}
      >
        {/* Each view has its own address, so these are links (the current one aria-current), not tabs. */}
        <nav ref={strip} className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1" aria-label="Records">
          {views.map(({ v, label, icon: Icon, hint }) => (
            // The current view links to itself as it stands (its filters kept), like the button it replaced.
            <Link key={v} to={view === v ? { pathname, search: sp.toString() ? `?${sp}` : "" } : hrefFor(v)} aria-current={view === v ? "page" : undefined} title={hint}
              className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:h-10",
                view === v ? "bg-accent text-accent-ink shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" : "text-text-muted hover:bg-text-base/[0.06] hover:text-text-base")}>
              <Icon className="size-4" aria-hidden />{label}
            </Link>
          ))}
        </nav>
      </PageHeader>
      {view === "listed" ? (
        <TeamDirectory season={season} onSeason={setSeason} />
      ) : view === "matches" ? (
        <RecordsTable key={`m${season}`} scope="match" season={season} predictable={predictable} defaultCols={MATCH_COLS} defaultSort="highScore"
          storageKey="matches" noun="matches" controls={{ onSeason: setSeason, region: true, eventType: true, dates: true }} />
      ) : view === "season" ? (
        <RecordsTable key={`s${season}`} scope="teamSeason" season={season} predictable={predictable} defaultCols={SEASON_COLS} defaultSort="totalPointsNpOpr"
          storageKey="team-seasons" noun="teams" selectable controls={{ onSeason: setSeason, region: true }} />
      ) : (
        <RecordsTable key={`e${season}`} scope="teamEvent" season={season} predictable={predictable} defaultCols={TEAM_COLS} defaultSort="totalPointsNpOpr"
          storageKey="team-events" noun="team-events" selectable controls={{ onSeason: setSeason, region: true, eventType: true, dates: true }} />
      )}
    </div>
  );
}
