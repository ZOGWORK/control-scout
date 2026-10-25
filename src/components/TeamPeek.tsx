// A team's key numbers in a side panel (a bottom sheet on phones), opened from the advancement view so a
// click on a team keeps the event in view instead of leaving for the team page. "Full team page" is inside.
import { Link } from "react-router-dom";
import { ArrowUpRight, Crown, Gauge, MapPin, Trophy, Users } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useMediaQuery } from "../lib/meta";
import type { TeamProfile } from "../shared/api";
import type { ForecastTeam } from "./Advancement";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/overlay";
import { Button } from "./ui/button";
import { Badge } from "./ui/basic";
import { ErrorState } from "./states";
import { dateRange, oddsPct, seasonLabel } from "../lib/format";
import { cn } from "./cn";

const rankRange = (a: number, b: number) => (Math.round(a) === Math.round(b) ? `#${Math.round(a)}` : `#${Math.round(a)}–${Math.round(b)}`);
const record = (w: number | null, l: number | null, t: number | null) => (w == null ? "—" : `${w}-${l ?? 0}-${t ?? 0}`);
const num = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));

export function TeamPeek({ team, season, eventName, row, status, settled = false, over = false, open, onOpenChange, onShowOutlook }: {
  team: number | null;
  season: number;
  eventName: string;
  /** This event's forecast for the team. */
  row?: ForecastTeam;
  /** "qualified" / "ineligible" replace the odds. */
  status?: "qualified" | "ineligible" | null;
  /** Alliance selection is done: captain and picked read Yes or No. */
  settled?: boolean;
  /** Playoffs are over: win odds are decided (100% or 0%). */
  over?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Show this team's outlook in the view behind (the lab, the event page). */
  onShowOutlook?: (team: number) => void;
}) {
  const wide = useMediaQuery("(min-width: 640px)");
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={wide ? "right" : "bottom"} className="gap-5 sm:max-w-lg">
        {team != null && <PeekBody team={team} season={season} eventName={eventName} row={row} status={status} settled={settled} over={over} onShowOutlook={onShowOutlook && (() => { onOpenChange(false); onShowOutlook(team); })} />}
      </SheetContent>
    </Sheet>
  );
}

function PeekBody({ team, season, eventName, row, status, settled, over, onShowOutlook }: { team: number; season: number; eventName: string; row?: ForecastTeam; status?: "qualified" | "ineligible" | null; settled?: boolean; over?: boolean; onShowOutlook?: () => void }) {
  const yesNo = (p: number) => (p >= 0.5 ? "Yes" : "No");
  const state = useApi<TeamProfile>(`/api/teams/${team}${qs({ season })}`);
  const p = state.data?.team?.number === team ? state.data : undefined;
  const place = p ? [p.team.city, p.team.state, p.team.country].filter(Boolean).join(", ") : "";
  const st = p?.stats;
  const events = (p?.events ?? []).slice(-6).reverse();
  return (
    <>
      <SheetHeader className="pr-8 text-left">
        <SheetTitle className="font-display text-2xl">
          <span className="tabular-nums">{team}</span> <span className="text-muted-foreground">{p?.team.name ?? ""}</span>
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {place && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" aria-hidden />{place}</span>}
          {p?.team.rookieYear && <span>Rookie year {p.team.rookieYear}</span>}
          {!p && !state.error && <span className="skeleton inline-block h-4 w-40 rounded" />}
        </SheetDescription>
      </SheetHeader>

      {row && (
        <section aria-label={`At ${eventName}`} className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4">
          <p className="truncate text-xs text-muted-foreground">At {eventName}</p>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            {status === "qualified" ? <Badge variant="success">Already qualified</Badge>
              : status === "ineligible" ? <Badge variant="outline">Not eligible to advance here</Badge>
              : <p className="font-display text-4xl font-semibold tabular-nums">{oddsPct(row.pAdvance)} <span className="text-sm font-normal text-muted-foreground">to advance</span></p>}
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Fact icon={Gauge} k="Likely rank" v={rankRange(row.rank.p10, row.rank.p90)} />
            <Fact icon={Crown} k="Captain" v={settled ? yesNo(row.pCaptain) : oddsPct(row.pCaptain)} />
            <Fact icon={Users} k="Picked" v={settled ? yesNo(row.pPicked) : oddsPct(row.pPicked)} />
            <Fact icon={Trophy} k="Win event" v={oddsPct(row.pWin, over)} />
          </dl>
        </section>
      )}

      {state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : (
        <section aria-label={`${seasonLabel(season)} season`}>
          <h3 className="mb-2 text-sm font-semibold">{seasonLabel(season)} season</h3>
          {!p ? <div className="skeleton h-24 rounded-xl" /> : !st ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">No matches on record for {team} in {seasonLabel(season)} yet.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-3">
              <Tile k="Record" v={record(st.record.wins, st.record.losses, st.record.ties)} hint={`${st.record.matches} matches, ${st.record.events} event${st.record.events === 1 ? "" : "s"}`} />
              <Tile k="OPR" v={num(st.opr.np.value)} hint={st.opr.np.rank ? `#${st.opr.np.rank} of ${st.opr.np.of}` : "non-penalty"} />
              <Tile k="Rating" v={st.rating ? `${st.rating.np.toFixed(0)} ±${st.rating.sd.toFixed(0)}` : "—"} hint={st.rating?.rank ? `#${st.rating.rank} worldwide` : "points per match"} />
              <Tile k="Avg score" v={num(st.avg.np, 0)} hint="non-penalty, alliance" />
            </dl>
          )}
        </section>
      )}

      {p && events.length > 0 && (
        <section aria-label="Events">
          <h3 className="mb-2 text-sm font-semibold">Events</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {events.map((e) => (
              <li key={e.code}>
                <Link to={`/events/${e.season}/${e.code}`} className="flex items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-text-base/[0.04]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{dateRange(e.start, e.end)}</span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {e.rank != null ? <span className="block font-medium text-foreground">#{e.rank}</span> : <span className="block">Upcoming</span>}
                    {e.wins != null && <span className="block">{record(e.wins, e.losses, e.ties)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={cn("mt-auto flex flex-wrap gap-2 border-t border-border pt-4")}>
        {onShowOutlook && <Button size="sm" onClick={onShowOutlook}>See {team}'s outlook</Button>}
        <Button asChild variant="outline" size="sm"><Link to={`/teams/${team}${qs({ season })}`}>Full team page <ArrowUpRight /></Link></Button>
      </div>
    </>
  );
}

function Fact({ icon: Icon, k, v }: { icon: typeof Gauge; k: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="size-3" aria-hidden />{k}</dt>
      <dd className="font-medium tabular-nums">{v}</dd>
    </div>
  );
}

function Tile({ k, v, hint }: { k: string; v: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">{v}</dd>
      <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>
    </div>
  );
}
