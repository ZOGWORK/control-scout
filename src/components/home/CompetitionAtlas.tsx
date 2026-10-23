// The competition atlas: where this season's teams are from, by the country their
// directory entry reports (GET /api/home/overview). The drawing (AtlasMap) loads on
// its own, in space kept for it, so search and everything else work first; if it
// can't load, the country selector and the full list still say everything.
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { ArrowRight, Globe2, Hourglass, Map as MapIcon, Pause, Play, Trophy, Users } from "lucide-react";
import type { CountryTotal, HomeOverview } from "../../shared/home";
import { seasonLabel } from "../../lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { cn } from "../cn";
import { countryHref, directoryHref, pickCountry, reconcile, resultsLine, unmappedLabel } from "./atlasModel";

const loadMap = () => import("./AtlasMap");
const AtlasMap = lazy(loadMap);

/** Start fetching the map's code and boundaries early (alongside the page's data), so the atlas is ready
 *  when its numbers arrive. Failures are left for the atlas itself to show. */
export function preloadAtlas(): void {
  loadMap().then((m) => m.loadWorld()).catch(() => {});
}

type Mode = "globe" | "flat";

/** Keeps a failed map chunk from taking the page down with it. */
class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const fmt = (n: number) => n.toLocaleString();

/**
 * A country's two ways in: every team registered there ("All listed teams", the directory, which
 * works with no results at all), and the teams with results (their statistics). The second is only
 * stated as a count, or as nobody having played, when the season's statistics are ready (DATA-F01).
 */
function CountryPaths({ country, overview, currentSeason, side }: { country: CountryTotal; overview: HomeOverview; currentSeason: number; side: boolean }) {
  const line = resultsLine(country, overview.readiness);
  const path = "group flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <div className={cn("mt-3 grid gap-2 text-sm @lg/atlas:grid-cols-2", side && "@xl/atlas:grid-cols-1")}>
      <Link to={countryHref(country.code, overview.season, currentSeason, "listed")} className={cn(path, "border-accent/30 bg-accent/[0.07] hover:bg-accent/[0.12]")}>
        <Users className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-accent-text">All {fmt(country.listings)} listed {country.listings === 1 ? "team" : "teams"}</span>
          <span className="block text-xs text-text-muted">Every registration, played or not</span>
        </span>
        <ArrowRight className="size-4 shrink-0 text-accent-text transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
      </Link>
      {line.kind === "link" ? (
        <Link to={countryHref(country.code, overview.season, currentSeason)} className={cn(path, "border-success/30 bg-success/[0.07] hover:bg-success/[0.12]")}>
          <Trophy className="size-4 shrink-0 text-success" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-success">{fmt(line.count)} {line.count === 1 ? "team" : "teams"} with results</span>
            <span className="block text-xs text-text-muted">{line.behind ? "So far: newer results are still being added" : "Ranked by this season’s statistics"}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-success transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </Link>
      ) : line.kind === "none" ? (
        <p className={cn(path, "border-line text-text-muted")}>
          <Trophy className="size-4 shrink-0" aria-hidden />
          <span>No {country.name} team has played a match yet this season.</span>
        </p>
      ) : (
        <p className={cn(path, "border-warning/30 bg-warning/[0.06] text-text-muted")}>
          <Hourglass className="size-4 shrink-0 text-warning" aria-hidden />
          <span>
            <span className="block font-semibold text-text-base">Results are still being prepared</span>
            <span className="block text-xs">{line.kind === "preparing"
              ? "This season’s statistics aren’t ready yet, so teams with results can’t be counted. Every listed team is browsable now."
              : `None from ${country.name} in the last statistics; newer results are waiting to be added.`}</span>
          </span>
        </p>
      )}
    </div>
  );
}

export function CompetitionAtlas({ overview, currentSeason, compact, homeCountry }: {
  overview: HomeOverview; currentSeason: number; compact?: boolean;
  /** The country shown first: the member's home team's (signed in), else the United States. Choosing another
   *  country (the map, the list, the selector) only changes what's shown here; it's never saved. */
  homeCountry?: string | null;
}) {
  const [mode, setMode] = useState<Mode>("globe");
  const [picked, setWanted] = useState<string | null>(null);
  const wanted = picked ?? homeCountry ?? "US";
  const [drawn, setDrawn] = useState<ReadonlySet<string> | null>(null);
  const [failed, setFailed] = useState(false);
  // The globe turns on its own unless the visitor asks for less motion; the pause button stops it either way.
  const reduced = !!useReducedMotion();
  const [paused, setPaused] = useState<boolean | null>(null);
  const still = paused ?? reduced;
  const selected = pickCountry(overview, wanted);
  const totals = reconcile(overview, drawn);
  const byName = [...overview.countries].sort((a, b) => a.name.localeCompare(b.name));
  const season = seasonLabel(overview.season);
  // The globe is square, so its country panel can sit beside it; the flat map is wide and keeps it below.
  const side = mode === "globe";

  const mapFallback = (
    <div className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 max-sm:px-4 text-center text-sm text-text-muted", mode === "globe" ? "aspect-square" : "aspect-[100/52]")}>
      <MapIcon className="size-5" aria-hidden />
      The map couldn’t load. Every country is in the selector and the list below.
    </div>
  );
  // Space kept for the map while it loads (no skeleton shimmer: it isn't the page's content).
  const mapLoading = (
    <div className={cn("flex w-full items-center justify-center", mode === "globe" ? "aspect-square" : "aspect-[100/52]")} aria-hidden>
      <div className={cn("border border-line", mode === "globe" ? "aspect-square w-[92%] rounded-full" : "h-[92%] w-full rounded-[50%]")} />
    </div>
  );

  return (
    <section aria-labelledby="atlas-title" className="@container/atlas min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 id="atlas-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">FTC Control Scout</h2>
        <div className="flex items-center gap-2">
        {mode === "globe" && !failed && drawn && (
          <button type="button" onClick={() => setPaused(!still)} aria-label={still ? "Turn the globe" : "Stop the globe turning"}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-text-muted hover:bg-text-base/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent max-sm:size-10">
            {still ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          </button>
        )}
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} aria-label="Map projection">
          <ToggleGroupItem value="globe" aria-label="Globe" className="max-sm:h-10"><Globe2 /> Globe</ToggleGroupItem>
          <ToggleGroupItem value="flat" aria-label="Flat atlas" className="max-sm:h-10"><MapIcon /> Atlas</ToggleGroupItem>
        </ToggleGroup>
        </div>
      </div>

      {/* Where there's room, the globe and the selected country sit side by side (the country's details used to
          stack under it, pushing the rest of the page down); the wide flat map keeps them underneath. */}
      <div className={cn("mt-3", side && "@xl/atlas:grid @xl/atlas:grid-cols-[minmax(0,1fr)_15.5rem] @xl/atlas:items-center @xl/atlas:gap-5")}>
        <div className={cn("mx-auto w-full", mode === "globe" && (compact ? "max-w-[22rem]" : "max-w-[30rem]"))}>
          {failed ? mapFallback : (
            <MapBoundary fallback={mapFallback}>
              <Suspense fallback={mapLoading}>
                <AtlasMap mode={mode} spinning={!still} countries={overview.countries} selected={selected?.numeric ?? null}
                  onSelect={setWanted} onLoaded={setDrawn} onError={() => setFailed(true)} />
              </Suspense>
            </MapBoundary>
          )}
        </div>

        <div className={cn("mt-4 min-w-0", side && "@xl/atlas:mt-0")}>
          <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", side && "@xl/atlas:flex-col @xl/atlas:items-stretch")}>
            <div className="min-w-0" aria-live="polite">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Selected country</p>
              {selected ? (
                <>
                  <p className="mt-1 font-display text-lg font-semibold leading-snug">{selected.name}</p>
                  <p className="font-display text-4xl font-semibold tabular-nums text-accent-display">{fmt(selected.listings)}</p>
                  <p className="text-sm text-text-muted">team listings · {season}</p>
                </>
              ) : <p className="mt-1 text-sm text-text-muted">No team listings for {season} yet.</p>}
            </div>
            {byName.length > 0 && (
              <div className="flex min-w-[12rem] flex-col gap-1">
                <span id="atlas-explore" className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Explore</span>
                <Select value={selected?.code ?? ""} onValueChange={setWanted}>
                  <SelectTrigger aria-labelledby="atlas-explore" className="h-11 w-full rounded-lg bg-card text-sm max-sm:h-11"><SelectValue placeholder="Choose a country" /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    {byName.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        <span className="flex w-full items-center justify-between gap-3">{c.name}<span className="tabular-nums text-text-muted">{fmt(c.listings)}</span></span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {selected && <CountryPaths country={selected} overview={overview} currentSeason={currentSeason} side={side} />}
        </div>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Country totals from each team’s reported country, not team locations. A listing is a registration for the season, not a sign the team has competed.{mode === "globe" && !failed ? ` Drag the globe with a mouse or focus it and use the arrow keys to turn it${still ? "" : "; the pause button stops it"}.` : ""}
      </p>

      <details className="group mt-3 rounded-xl border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 text-sm font-medium">
          All {overview.countries.length} countries and territories
          <ArrowRight className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
        </summary>
        <div className="border-t border-line px-4 py-3 text-sm">
          <ul className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {byName.map((c) => (
              <li key={c.code}>
                <button type="button" onClick={() => setWanted(c.code)} aria-pressed={c.code === selected?.code} aria-label={`${c.name}: ${fmt(c.listings)} team listings`}
                  className={cn("flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 text-left hover:bg-text-base/[0.05]", c.code === selected?.code && "bg-accent/10 font-semibold")}>
                  <span>{c.name}{drawn && !drawn.has(c.numeric) ? <span className="ml-1.5 text-xs font-normal text-text-muted">not drawn at this scale</span> : null}</span>
                  <span className="tabular-nums text-text-muted">{fmt(c.listings)}</span>
                </button>
              </li>
            ))}
            {overview.unmapped.map((u) => (
              <li key={u.label ?? "(none)"} className="flex min-h-9 items-center justify-between gap-3 px-2 text-text-muted">
                <span>{unmappedLabel(u.label)}</span><span className="tabular-nums">{fmt(u.listings)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-line pt-3 text-xs text-text-muted">
            {fmt(totals.drawn)} on the map{totals.undrawn ? ` + ${fmt(totals.undrawn)} in countries too small to draw at this scale` : ""}{totals.unmapped ? ` + ${fmt(totals.unmapped)} without a country` : ""} = {fmt(totals.total)} team listings for {season}.
            {totals.unmapped ? <>{" "}Teams without a country we can place are in the <Link to={directoryHref(overview.season, currentSeason)} className="font-medium text-accent-text hover:underline">directory of every listed team</Link>.</> : null}
            {" "}Boundaries: Natural Earth 4.1.0 (1:110m, public domain).
          </p>
        </div>
      </details>
    </section>
  );
}
