// /teams and /matches: a season's records, every team-event, team season or
// match, filtered, sorted, compared and exported (FTC Scout's records pages,
// plus Control Scout's prediction stats, saved filters and preset chips).
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { CalendarDays, Swords, Users } from "lucide-react";
import { useCurrentSeason, usePredictable, useTitle } from "../lib/meta";
import { seasonLabel } from "../lib/format";
import { PageHeader } from "../components/page";
import { RecordsTable } from "../components/records/RecordsTable";
import { cn } from "../components/cn";

type View = "events" | "season" | "matches";

const TEAM_COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr", "totalPointsNpAvg", "totalPointsNpMax", "rank", "rp", "qualMatchesPlayed", "predictedWinPctAvg", "advancementOdds"];
const SEASON_COLS = ["totalPointsNpOpr", "autoPointsOpr", "dcPointsOpr", "endgamePointsOpr", "penaltyPointsCommittedOpr", "totalPointsNpAvg", "totalPointsNpMax", "events", "qualMatchesPlayed", "wins", "losses", "ties", "predictedWinPctAvg"];
const MATCH_COLS = ["redTotalPoints", "blueTotalPoints", "winningMargin", "highScore", "redAutoPoints", "blueAutoPoints", "redDcPoints", "blueDcPoints", "redEndgamePoints", "blueEndgamePoints", "redPredictedWinPct"];

export default function RecordsPage({ matches }: { matches?: boolean }) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const view: View = matches ? "matches" : sp.get("view") === "season" ? "season" : "events";
  const predictable = usePredictable(season);
  useTitle(matches ? `Match records ${seasonLabel(season)}` : `Team records ${seasonLabel(season)}`);

  // Switching view or season starts the table afresh (a filter's stats differ per table), keeping the season.
  const go = (v: View, s = season) => {
    const q = new URLSearchParams();
    if (s !== current) q.set("season", String(s));
    if (v === "season") q.set("view", "season");
    // A country (from the home page's atlas) stays on across the two team views.
    const country = sp.get("country");
    if (country && v !== "matches") q.set("country", country);
    navigate({ pathname: v === "matches" ? "/matches" : "/teams", search: q.toString() ? `?${q}` : "" });
  };
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
    { v: "matches", label: "Matches", icon: Swords, hint: "One row per played match" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">Records · {seasonLabel(season)}</span>}
        title={matches ? "Match records" : "Teams"}
        description={matches
          ? "Every played match of the season: filter by score, margin, phase or event, sort any column, export it."
          : "Every team's numbers for the season. Filter with any stat, sort any column, tick teams to compare, export to CSV."}
      >
        <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-line bg-card p-1" role="tablist" aria-label="Records">
          {views.map(({ v, label, icon: Icon, hint }) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} title={hint} onClick={() => view !== v && go(v)}
              className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors max-sm:h-11",
                view === v ? "bg-accent text-accent-ink shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" : "text-text-muted hover:bg-text-base/[0.06] hover:text-text-base")}>
              <Icon className="size-4" />{label}
            </button>
          ))}
        </div>
      </PageHeader>
      {view === "matches" ? (
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
