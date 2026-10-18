// The competition atlas: where this season's teams are from, by the country their
// directory entry reports (GET /api/home/overview). The drawing (AtlasMap) loads on
// its own, in space kept for it, so search and everything else work first; if it
// can't load, the country selector and the full list still say everything.
import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useReducedMotion } from "motion/react";
import { ArrowRight, Globe2, Map as MapIcon, Pause, Play } from "lucide-react";
import type { HomeOverview } from "../../shared/home";
import { seasonLabel } from "../../lib/format";
import { ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { cn } from "../cn";
import { countryHref, pickCountry, reconcile, unmappedLabel } from "./atlasModel";

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

export function CompetitionAtlas({ overview, currentSeason, compact }: { overview: HomeOverview; currentSeason: number; compact?: boolean }) {
  const [mode, setMode] = useState<Mode>(compact ? "flat" : "globe");
  const [wanted, setWanted] = useState<string | null>(null);
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

  const mapFallback = (
    <div className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line px-6 text-center text-sm text-text-muted", mode === "globe" ? "aspect-square" : "aspect-[100/52]")}>
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
    <section aria-labelledby="atlas-title" className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 id="atlas-title" className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">FTC Control Scout</h2>
        <div className="flex items-center gap-2">
        {mode === "globe" && !failed && drawn && (
          <button type="button" onClick={() => setPaused(!still)} aria-label={still ? "Turn the globe" : "Stop the globe turning"}
            className="inline-flex size-9 items-center justify-center rounded-lg border border-line text-text-muted hover:bg-text-base/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent max-sm:size-11">
            {still ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
          </button>
        )}
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as Mode)} aria-label="Map projection">
          <ToggleGroupItem value="globe" aria-label="Globe" className="max-sm:h-11"><Globe2 /> Globe</ToggleGroupItem>
          <ToggleGroupItem value="flat" aria-label="Flat atlas" className="max-sm:h-11"><MapIcon /> Atlas</ToggleGroupItem>
        </ToggleGroup>
        </div>
      </div>

      <div className={cn("mx-auto mt-3", mode === "globe" && (compact ? "max-w-[22rem]" : "max-w-[30rem]"))}>
        {failed ? mapFallback : (
          <MapBoundary fallback={mapFallback}>
            <Suspense fallback={mapLoading}>
              <AtlasMap mode={mode} spinning={!still} countries={overview.countries} selected={selected?.numeric ?? null}
                onSelect={setWanted} onLoaded={setDrawn} onError={() => setFailed(true)} />
            </Suspense>
          </MapBoundary>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0" aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Selected country</p>
          {selected ? (
            <>
              <p className="mt-1 font-display text-lg font-semibold">{selected.name}</p>
              <p className="font-display text-4xl font-semibold tabular-nums text-accent-text">{fmt(selected.listings)}</p>
              <p className="text-sm text-text-muted">team listings · {season}</p>
            </>
          ) : <p className="mt-1 text-sm text-text-muted">No team listings for {season} yet.</p>}
        </div>
        {byName.length > 0 && (
          <label className="flex min-w-[12rem] flex-col gap-1 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
            Explore
            <select value={selected?.code ?? ""} onChange={(e) => setWanted(e.target.value)}
              className="h-11 rounded-lg border border-input bg-card px-3 text-sm font-normal normal-case tracking-normal text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              {byName.map((c) => <option key={c.code} value={c.code}>{c.name} ({fmt(c.listings)})</option>)}
            </select>
          </label>
        )}
      </div>

      {selected && (
        <p className="mt-3 text-sm">
          {selected.withResults > 0 ? (
            <Link to={countryHref(selected.code, overview.season, currentSeason)} className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-text hover:underline">
              {fmt(selected.withResults)} {selected.withResults === 1 ? "team has" : "teams have"} results this season <ArrowRight className="size-4" />
            </Link>
          ) : <span className="text-text-muted">No {selected.name} team has played a match yet this season.</span>}
        </p>
      )}
      <p className="mt-2 text-xs text-text-muted">
        Country totals from each team’s reported country, not team locations.{mode === "globe" && !failed ? ` Drag the globe with a mouse to turn it${still ? "" : ", or stop it with the pause button"}.` : ""}
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
            {" "}Boundaries: Natural Earth 4.1.0 (1:110m, public domain).
          </p>
        </div>
      </details>
    </section>
  );
}
