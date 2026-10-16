// /rankings: the world ranking. Every rated team in the season by its prediction-engine rating, with
// its move since last week, filterable by country and state, one page of 50 at a time. Everything is
// in the URL (?season=&region=&week=&page=), so a link reproduces the view. Rules and definitions:
// src/shared/rankings.ts. No charts on this route: it is linked around and must stay light.
import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, ListOrdered, MapPin, Minus, Search, Star, TrendingDown, TrendingUp, Trophy, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMeta, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { ago, seasonLabel } from "../lib/format";
import { regionLabel } from "../shared/regions";
import { trendLabel } from "../shared/trend";
import { parsePlaces, placeKey, type RankingPlaces, type RankingRow, type RankingsResponse } from "../shared/rankings";
import { PageHeader, EmptyState } from "../components/page";
import { ErrorState } from "../components/states";
import { Badge, Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/overlay";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/controls";
import { cn } from "../components/cn";

const trigger = "inline-flex h-9 max-w-full items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors max-sm:h-11";
const idle = "border-line bg-card text-text-base hover:border-text-base/25";
const active = "border-accent/60 bg-accent/[0.08] text-text-base";

/** "USA:TX" → "Texas", "Canada" → "Canada". */
const placeName = (key: string) => (key.includes(":") ? regionLabel(key) : key);
/** A state or province's name ("Texas"), or null where we only have FIRST's code (most countries outside North America). */
const stateName = (country: string, state: string) => { const n = regionLabel(`${country}:${state.toUpperCase()}`); return n && n !== state.toUpperCase() ? n : null; };
/** A team's home in a few words: "Texas, USA", "Ontario, Canada", "Romania". */
const homeOf = (r: Pick<RankingRow, "state" | "country">) => {
  if (!r.country) return "";
  const st = r.state ? stateName(r.country, r.state) : null;
  return st ? `${st}, ${r.country}` : r.country;
};
const weekLabel = (w: string, year = true) => new Date(`${w}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

export default function RankingsPage() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const seasonParam = Number(sp.get("season")) || null;
  const places = useMemo(() => parsePlaces(sp.get("region")) ?? [], [sp]);
  const week = sp.get("week");
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const { state: personal } = usePersonal();
  const myTeam = personal.myTeam;

  const path = `/api/rankings${qs({ season: seasonParam, region: places.map(placeKey).join(","), week, page: page > 1 ? page : null })}`;
  const res = useApi<RankingsResponse>(path);
  // While the next page or filter loads, the last one stays on screen (dimmed), not a skeleton.
  const last = useRef<RankingsResponse | undefined>(undefined);
  if (res.data) last.current = res.data;
  const data = res.data ?? (res.error ? undefined : last.current);
  const season = data?.season ?? seasonParam ?? current;
  const placesInfo = useApi<RankingPlaces>(data ? `/api/rankings/places${qs({ season: data.season, team: myTeam })}` : null);

  const regionText = places.length === 1 ? placeName(placeKey(places[0])) : places.length ? `${places.length} places` : null;
  useTitle(`${regionText ? `FTC rankings: ${regionText}` : "FTC world rankings"} ${seasonLabel(season)}${week ? `, week of ${weekLabel(week)}` : ""}`);

  /** Change the URL: a new filter, season or week starts again at page 1. */
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") q.delete(k); else q.set(k, v); }
    if (!("page" in patch)) q.delete("page");
    setSp(q);
  };
  const setPlaces = (keys: string[]) => go({ region: keys.join(",") || null });
  // Your team's state when we can name it (as the filter offers), else its country.
  const mineRaw = placesInfo.data?.mine ?? null;
  const [mineCountry, mineState] = (mineRaw ?? "").split(":");
  const mine = !mineRaw ? null : mineState && !stateName(mineCountry, mineState) ? mineCountry : mineRaw;
  const mineOn = !!mine && places.length === 1 && placeKey(places[0]) === mine;

  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">World rankings{data || seasonParam ? ` · ${seasonLabel(season)}` : ""}</span>}
        title={regionText ? `Rankings: ${regionText}` : "World rankings"}
        description="Every rated FTC team by prediction rating, with each team's move since last week."
      >
        {/* One row, its height fixed (sideways scroll on a phone): nothing below moves as the choices fill in. */}
        <div className="flex h-11 items-center gap-2 overflow-x-auto [scrollbar-width:none] max-sm:-mx-4 max-sm:px-4 sm:h-9 sm:overflow-visible [&>*]:shrink-0">
          {data || seasonParam ? <SeasonPick value={season} onChange={(s) => go({ season: String(s), week: null })} /> : <div className="skeleton h-9 w-36 rounded-lg max-sm:h-11" aria-hidden />}
          <PlacePicker info={placesInfo.data} loading={placesInfo.loading} value={places.map(placeKey)} onChange={setPlaces} />
          {mine && (
            <button type="button" onClick={() => setPlaces(mineOn ? [] : [mine])} aria-pressed={mineOn}
              className={cn(trigger, mineOn ? active : idle)} title={`Teams from ${placeName(mine)}, where team ${myTeam} is from`}>
              <Star className="size-4 text-accent" />My region<span className="text-text-muted max-sm:hidden">· {placeName(mine)}</span>
            </button>
          )}
          {data && data.weeks.length > 0 && (
            <WeekPick weeks={data.weeks} value={week} liveLabel={season === current ? "This week" : "Season end"} onChange={(w) => go({ week: w })} />
          )}
          {places.length > 0 && <Button variant="ghost" size="sm" onClick={() => setPlaces([])} className="max-sm:h-11"><X />Clear</Button>}
        </div>
      </PageHeader>

      {res.error && !data ? <ErrorState error={res.error} onRetry={res.reload} /> : !data ? <TableSkeleton /> : (
        <div className={cn("transition-opacity", res.loading && "opacity-60")} aria-busy={res.loading}>
          <Summary data={data} />
          {data.total === 0 ? (
            <EmptyState icon={ListOrdered}
              title={data.ranked === 0 ? `No team is rated yet in ${seasonLabel(data.season)}` : "No ranked team from there"}
              description={data.ranked === 0
                ? "A team is ranked after its third rated match. Rankings fill in as the season's first qualifiers and league meets are played."
                : `None of the ${data.ranked.toLocaleString()} rated teams is from ${regionText ?? "that place"}. Try a whole country, or clear the filter.`}
              action={places.length ? <Button variant="secondary" onClick={() => setPlaces([])}>Show every team</Button> : undefined} />
          ) : (
            <>
              <RankTable data={data} myTeam={myTeam} />
              <Pager data={data} sp={sp} />
            </>
          )}
          <Explainer />
        </div>
      )}
    </div>
  );
}

function Summary({ data }: { data: RankingsResponse }) {
  const parts = [
    data.total === data.ranked ? `${data.ranked.toLocaleString()} rated teams` : `${data.total.toLocaleString()} of ${data.ranked.toLocaleString()} rated teams`,
    data.baseline ? `moves since the week of ${weekLabel(data.baseline)}` : null,
    data.week ? `as of ${weekLabel(data.week)}, 00:00 UTC` : data.asOf ? `updated ${ago(data.asOf)}` : null,
  ].filter(Boolean);
  return <p className="mb-3 text-sm text-text-muted">{parts.join(" · ")}</p>;
}

function SeasonPick({ value, onChange }: { value: number; onChange: (s: number) => void }) {
  const meta = useMeta();
  const seasons = (meta?.seasons ?? []).filter((s) => s.predictable);
  const list = seasons.some((s) => s.season === value) ? seasons : [{ season: value, game: "" }, ...seasons];
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn(trigger, idle, "w-auto")} aria-label="Season"><Trophy className="size-4 text-accent" /><SelectValue /></SelectTrigger>
      <SelectContent className="min-w-[14rem]">
        {list.map((s) => <SelectItem key={s.season} value={String(s.season)}><span className="font-semibold tabular-nums">{seasonLabel(s.season)}</span>{s.game && <span className="text-text-muted"> · {s.game}</span>}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function WeekPick({ weeks, value, liveLabel, onChange }: { weeks: string[]; value: string | null; liveLabel: string; onChange: (w: string | null) => void }) {
  return (
    <Select value={value ?? "live"} onValueChange={(v) => onChange(v === "live" ? null : v)}>
      <SelectTrigger className={cn(trigger, value ? active : idle, "w-auto")} aria-label="Week"><SelectValue /></SelectTrigger>
      <SelectContent className="max-h-[min(24rem,60dvh)] min-w-[13rem]">
        <SelectItem value="live">{liveLabel}</SelectItem>
        {weeks.map((w) => <SelectItem key={w} value={w}>Week of {weekLabel(w)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Country / state filter: searchable, several at once; a country opens to its states. */
function PlacePicker({ info, loading, value, onChange }: { info: RankingPlaces | undefined; loading: boolean; value: string[]; onChange: (keys: string[]) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const f = q.trim().toLowerCase();
  const toggle = (k: string) => onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k].slice(0, 10));
  const text = !value.length ? "Everywhere" : value.length === 1 ? placeName(value[0]) : `${value.length} places`;
  const countries = info?.countries ?? [];
  const Row = ({ k, label, teams, indent }: { k: string; label: string; teams: number; indent?: boolean }) => {
    const on = value.includes(k);
    return (
      <button type="button" role="option" aria-selected={on} onClick={() => toggle(k)}
        className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-text-base/[0.06] max-sm:py-2.5", indent && "pl-7", on && "bg-accent/[0.08]")}>
        <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-ink" : "border-text-base/30")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[11px] tabular-nums text-text-muted">{teams.toLocaleString()}</span>
      </button>
    );
  };
  return (
    <Popover onOpenChange={(o) => { if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(trigger, value.length ? active : idle)} aria-label={`Region: ${text}`}>
          <MapPin className="size-4 text-sky-500" /><span className="max-w-[12rem] truncate">{text}</span><ChevronDown className="size-4 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[min(28rem,70dvh)] w-[min(92vw,20rem)] flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Texas, Canada, Romania…" aria-label="Search places" className="h-9 pl-8 max-sm:h-11" />
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable aria-label="Places">
          {loading && !countries.length && <p className="px-2 py-4 text-center text-sm text-text-muted">Loading places…</p>}
          {countries.map((c) => {
            // Only states we can name: elsewhere FIRST's codes ("B", "VN") would mean nothing to most people.
            const states = c.states.flatMap((s) => { const name = stateName(c.country, s.state); return name ? [{ ...s, key: `${c.country}:${s.state}`, name }] : []; });
            const countryHit = !f || c.country.toLowerCase().includes(f);
            const stateHits = f ? states.filter((s) => s.name.toLowerCase().includes(f) || s.state.toLowerCase() === f) : states;
            if (!countryHit && !stateHits.length) return null;
            const expanded = (f && stateHits.length > 0) || open === c.country;
            return (
              <div key={c.country}>
                <div className="flex items-center">
                  <Row k={c.country} label={c.country} teams={c.teams} />
                  {states.length > 1 && !f && (
                    <button type="button" onClick={() => setOpen(open === c.country ? null : c.country)} aria-expanded={open === c.country}
                      aria-label={`${open === c.country ? "Hide" : "Show"} ${c.country}'s states`} className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-text-base/[0.06] max-sm:size-11">
                      <ChevronDown className={cn("size-4 transition-transform", open === c.country && "rotate-180")} />
                    </button>
                  )}
                </div>
                {expanded && stateHits.map((s) => <div key={s.key} className="flex"><Row k={s.key} label={s.name} teams={s.teams} indent /></div>)}
              </div>
            );
          })}
        </div>
        {value.length > 0 && <Button variant="ghost" size="sm" onClick={() => onChange([])}>Everywhere</Button>}
      </PopoverContent>
    </Popover>
  );
}

const th = "sticky top-0 z-10 h-11 whitespace-nowrap bg-card px-2 align-bottom pb-2 text-[11px] font-bold uppercase tracking-wider text-text-muted shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--color-text-base)_20%,transparent)] sm:px-4";
const td = "px-2 py-2.5 sm:px-4";

function RankTable({ data, myTeam }: { data: RankingsResponse; myTeam: number | null }) {
  const moves = data.baseline != null;
  return (
    <div className="rounded-xl border border-text-base/15 bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className={cn(th, "w-10 rounded-tl-xl text-right sm:w-14")} title={data.places.length ? "World rank" : undefined}><span className="sm:hidden">#</span><span className="max-sm:hidden">{data.places.length ? "World" : "Rank"}</span></th>
            {moves && <th scope="col" className={cn(th, "w-12 text-left sm:w-16")} title="Places moved since last week">Move</th>}
            <th scope="col" className={cn(th, "text-left")}>Team</th>
            <th scope="col" className={cn(th, "text-left max-md:hidden")}>From</th>
            <th scope="col" className={cn(th, "text-right", !moves && "rounded-tr-xl")} title="Expected points added to an alliance per match (auto + TeleOp + endgame)">Rating</th>
            {moves && <th scope="col" className={cn(th, "rounded-tr-xl text-left max-sm:hidden")}>Trend</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const me = r.team === myTeam;
            return (
              <tr key={r.team} className={cn("border-t border-text-base/10 hover:bg-text-base/[0.03]", me && "bg-accent/[0.07]")}>
                <td className={cn(td, "text-right font-display text-base font-semibold tabular-nums", r.rank <= 3 && "text-accent")}>{r.rank.toLocaleString()}</td>
                {moves && <td className={td}><Move row={r} /></td>}
                <td className={cn(td, "max-w-0 w-full")}>
                  <Link to={`/teams/${r.team}?season=${data.season}`} className="group block min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono font-semibold tabular-nums group-hover:text-accent">{r.team}</span>
                      <span className="truncate group-hover:text-accent">{r.name ?? ""}</span>
                    </span>
                    <span className="block truncate text-xs text-text-muted md:hidden">{homeOf(r)}</span>
                  </Link>
                </td>
                <td className={cn(td, "max-w-[14rem] truncate text-text-muted max-md:hidden")}>{homeOf(r)}</td>
                <td className={cn(td, "text-right tabular-nums")}>
                  <span className="font-semibold">{r.rating.toFixed(1)}</span>
                  {r.dRating != null && r.dRating !== 0 && <span className={cn("block text-[11px]", r.dRating > 0 ? "text-emerald-500" : "text-rose-500")}>{r.dRating > 0 ? "+" : ""}{r.dRating.toFixed(1)}</span>}
                </td>
                {moves && <td className={cn(td, "max-sm:hidden")}><TrendBadge row={r} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Move({ row }: { row: RankingRow }) {
  if (row.move === "new") return <Badge variant="beta" title="Not ranked last week">New</Badge>;
  if (row.move == null) return null;
  if (row.move === 0) return <span className="inline-flex items-center text-text-muted" title="Same place as last week"><Minus className="size-3.5" /><span className="sr-only">No change</span></span>;
  const up = row.move > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold tabular-nums", up ? "text-emerald-500" : "text-rose-500")} title={`${up ? "Up" : "Down"} ${Math.abs(row.move)} since last week`}>
      <Icon className="size-3.5" strokeWidth={2.5} />{Math.abs(row.move).toLocaleString()}<span className="sr-only"> {up ? "up" : "down"}</span>
    </span>
  );
}

function TrendBadge({ row }: { row: RankingRow }) {
  if (!row.trend) return null;
  return (
    <Badge variant={row.trend === "flat" ? "secondary" : row.trend === "up" ? "success" : "destructive"}>
      {row.trend === "up" ? <TrendingUp /> : row.trend === "down" ? <TrendingDown /> : null}{trendLabel(row.trend)}
    </Badge>
  );
}

function Pager({ data, sp }: { data: RankingsResponse; sp: URLSearchParams }) {
  if (data.pages <= 1) return null;
  const href = (p: number) => { const q = new URLSearchParams(sp); if (p > 1) q.set("page", String(p)); else q.delete("page"); const s = q.toString(); return s ? `?${s}` : "?"; };
  const from = (data.page - 1) * data.pageSize + 1, to = Math.min(data.total, data.page * data.pageSize);
  const nav = "inline-flex h-9 items-center gap-1 rounded-lg border border-line bg-card px-3 text-sm font-medium hover:border-text-base/25 max-sm:h-11";
  const off = "pointer-events-none opacity-40";
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3" aria-label="Pages">
      <p className="text-sm text-text-muted">{from.toLocaleString()}–{to.toLocaleString()} of {data.total.toLocaleString()}</p>
      <div className="flex items-center gap-2">
        <Link to={href(data.page - 1)} className={cn(nav, data.page <= 1 && off)} aria-disabled={data.page <= 1} rel="prev"><ChevronLeft className="size-4" />Previous</Link>
        <span className="px-1 text-sm tabular-nums text-text-muted">{data.page} / {data.pages}</span>
        <Link to={href(data.page + 1)} className={cn(nav, data.page >= data.pages && off)} aria-disabled={data.page >= data.pages} rel="next">Next<ChevronRight className="size-4" /></Link>
      </div>
    </nav>
  );
}

function Explainer() {
  return (
    <div className="mt-8 max-w-3xl space-y-2 text-sm text-text-muted">
      <h2 className="font-display text-base font-semibold text-text-base">How the rankings work</h2>
      <p>The rating is the prediction engine's estimate of the points a team's robot adds to its alliance in a match (auto, TeleOp and endgame, penalties left out). It updates after every rated match, and a team is ranked once it has played three. Equal ratings are ordered by team number.</p>
      <p>Each Monday at 00:00 UTC the ranking is saved. The arrows compare today's ranking with the one saved at least a week ago: ↑3 means three places higher, "New" means the team wasn't ranked then. Rising, Falling and Steady follow the same rule as the trends on team pages: a rating change under 8% is Steady.</p>
      <p>The rating is the same one behind every match prediction. <Link to="/methodology" className="text-accent hover:underline">How predictions work</Link>.</p>
    </div>
  );
}

function TableSkeleton() {
  return (
    // As tall as a page of rows (with the summary line above), so the footer doesn't jump when they arrive.
    <div aria-busy="true" aria-label="Loading rankings">
      <div className="skeleton mb-3 h-5 w-64 max-w-full rounded-md" />
      <div className="space-y-2 rounded-xl border border-line bg-card p-3">
        {Array.from({ length: 20 }, (_, i) => <div key={i} className="skeleton h-10 rounded-md" />)}
      </div>
    </div>
  );
}
