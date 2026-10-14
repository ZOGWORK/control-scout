// Event page: schedule + results (with predictions), rankings, playoff
// bracket, awards + advancement, and advancement odds for any team there.
import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Award, CalendarDays, ExternalLink, MapPin, Radio, Swords, Trophy } from "lucide-react";
import { BRACKETS, type Slot } from "@control-scout/predict-engine";
import { useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventDetail, FieldRow, MatchView } from "../shared/api";
import { EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Reveal } from "../components/motion";
import { Badge, Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { MatchList } from "../components/predict";
import { SortTable, type Col } from "../components/SortTable";
import { AdvancementView } from "../components/Advancement";
import { cn } from "../components/cn";
import { awardLabel, dateRange, num, place, seasonLabel } from "../lib/format";

export default function EventPage() {
  const { season, code } = useParams();
  const state = useApi<EventDetail>(`/api/events/${season}/${code}`);
  useTitle(state.data?.event.name ?? code);
  return <Async state={state}>{(d) => <Event d={d} />}</Async>;
}

function Event({ d }: { d: EventDetail }) {
  const [sp, setSp] = useSearchParams();
  const e = d.event;
  const { state: personal, update } = usePersonal();
  const ref = `${e.season}:${e.code}`;
  const tracked = personal.tracked.events.includes(ref);
  const teamParam = Number(sp.get("team")) || null;
  const names = useMemo(() => new Map(d.field.map((f) => [f.team, f.name ?? ""])), [d.field]);
  const nameOf = (t: number) => names.get(t) ?? "";
  const tab = sp.get("tab") ?? (sp.get("match") ? "matches" : e.status === "upcoming" && !d.matches.length ? "odds" : "matches");
  const setTab = (t: string) => setSp((x) => { x.set("tab", t); return x; }, { replace: true });
  const setTeam = (t: number) => setSp((x) => { x.set("team", String(t)); return x; }, { replace: true });
  return (
    <div>
      <Reveal className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent opacity-15 blur-3xl" />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {e.status === "live" ? <Badge variant="destructive"><Radio /> Live</Badge> : e.status === "upcoming" ? <Badge variant="secondary">Upcoming</Badge> : <Badge variant="outline">Finished</Badge>}
            <Badge variant="outline">{e.typeLabel}</Badge>
            <span className="font-mono text-xs text-muted-foreground">{e.code} · {seasonLabel(e.season)}</span>
          </div>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">{e.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><CalendarDays className="size-4" />{dateRange(e.start, e.end)}</span>
            {(e.venue || e.city) && <span className="flex items-center gap-1.5"><MapPin className="size-4" />{place(e.venue, e.city, e.state, e.country)}</span>}
            <span>{e.teams} teams · {e.matchesPlayed}/{e.matchesTotal} matches played</span>
            {e.livestream && <a href={e.livestream} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">Livestream <ExternalLink className="size-3" /></a>}
            {e.website && <a href={e.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">Website <ExternalLink className="size-3" /></a>}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant={tracked ? "secondary" : "outline"} size="sm" aria-pressed={tracked} onClick={() => update("tracked", (t) => ({ ...t, events: tracked ? t.events.filter((x) => x !== ref) : [...t.events, ref] }))}>
              {tracked ? "Tracking this event" : "Track event"}
            </Button>
            <Button variant="outline" size="sm" asChild><Link to={`/predict?mode=advancement&season=${e.season}&code=${e.code}${teamParam ? `&team=${teamParam}` : ""}`}>Open in prediction lab</Link></Button>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Source: {e.source === "first" ? "FIRST Events API" : "FTC Scout"}</p>
        </div>
        <EventGlance d={d} onTab={setTab} />
        </div>
      </Reveal>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="matches">Matches</TabsTrigger>
          <TabsTrigger value="rankings">Rankings</TabsTrigger>
          <TabsTrigger value="playoffs">Playoffs</TabsTrigger>
          <TabsTrigger value="awards">Awards</TabsTrigger>
          <TabsTrigger value="odds">Odds</TabsTrigger>
        </TabsList>
        <TabsContent value="matches" className="mt-5"><Matches d={d} team={teamParam} /></TabsContent>
        <TabsContent value="rankings" className="mt-5"><Rankings field={d.field} season={e.season} team={teamParam} code={e.code} /></TabsContent>
        <TabsContent value="playoffs" className="mt-5"><Playoffs d={d} /></TabsContent>
        <TabsContent value="awards" className="mt-5"><Awards d={d} nameOf={nameOf} /></TabsContent>
        <TabsContent value="odds" className="mt-5">
          {/* Every event with a schedule gets match predictions; advancement odds only where teams advance. */}
          <TeamPicker field={d.field} value={teamParam} onChange={setTeam} />
          {d.forecastUnsupported ? (
            <p className="mb-6 flex items-start gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
              <Trophy className="mt-0.5 size-4 shrink-0" />
              <span>{d.forecastUnsupported} Every scheduled match below still gets win odds and a predicted score.</span>
            </p>
          ) : (
            <section aria-label="Advancement odds" className="mb-10">
              <h2 className="mb-3 font-display text-lg font-semibold text-foreground">Advancement odds</h2>
              <AdvancementView season={e.season} code={e.code} team={teamParam} nameOf={nameOf} onPickTeam={setTeam} />
            </section>
          )}
          <MatchOdds d={d} team={teamParam} onTab={setTab} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Win odds and predicted scores for the matches still to play (one team's, when a team is picked). */
function MatchOdds({ d, team, onTab }: { d: EventDetail; team: number | null; onTab: (t: string) => void }) {
  const mine = (m: MatchView) => !team || [...m.red.teams, ...m.blue.teams].some((t) => t.number === team);
  const unplayed = d.matches.filter((m) => !m.played && mine(m));
  const predicted = unplayed.filter((m) => m.prediction);
  const played = d.matches.filter((m) => m.played && mine(m));
  const over = d.event.status === "finished";
  const who = team ? `${team}'s` : "the";
  // "all 12 of the matches" / "10 of 12 of 4215's matches" / "4215's only match"
  const scope = predicted.length === unplayed.length
    ? (unplayed.length === 1 ? (team ? `${who} only match` : "the only match") : `all ${unplayed.length} of ${who} matches`)
    : `${predicted.length} of ${who} ${unplayed.length} matches`;
  return (
    <section aria-label="Match predictions">
      <h2 className="mb-1 font-display text-lg font-semibold text-foreground">Match predictions</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        {predicted.length ? (predicted.some((m) => m.prediction?.noScoreBasis)
          ? `Win odds for ${scope} still to play. Predicted scores appear once this season has rated matches (scrimmages aren't rated), so until then the odds lean on last season.`
          : `Win odds and predicted scores for ${scope} still to play, from current ratings.`)
          : over || (played.length && !unplayed.length) ? <>All of {who} matches have been played. <button type="button" onClick={() => onTab("matches")} className="underline">See how the predictions did</button>.</>
            : unplayed.length ? "The scheduled matches don't have full 2-against-2 lineups yet, so there's nothing to predict until they do."
              : "No schedule published yet. Every match gets win odds and a predicted score as soon as it is (usually the morning of the event)."}
      </p>
      {!over && unplayed.length > 0 && <MatchList matches={unplayed} highlight={team ?? undefined} />}
    </section>
  );
}

function TeamPicker({ field, value, onChange }: { field: FieldRow[]; value: number | null; onChange: (t: number) => void }) {
  const [q, setQ] = useState("");
  const options = field.filter((f) => !q || String(f.team).includes(q) || (f.name ?? "").toLowerCase().includes(q.toLowerCase())).slice(0, 8);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">Odds for team</span>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? String(value) : "type a number or name"} className="h-9 w-48" aria-label="Pick a team at this event" />
      {q && options.map((f) => <Button key={f.team} size="sm" variant="secondary" onClick={() => { onChange(f.team); setQ(""); }}>{f.team} {f.name && <span className="max-w-32 truncate text-muted-foreground">{f.name}</span>}</Button>)}
    </div>
  );
}

/** How the predictions did here, live calls and backtest replays kept apart
 *  (decided matches only; live first when there are any). */
function callRecord(matches: MatchView[]): { kind: "live" | "backtest"; n: number; right: number }[] {
  const decided = matches.filter((m) => m.played && m.prediction && m.red.score && m.blue.score && m.red.score.total !== m.blue.score.total);
  return (["live", "backtest"] as const).map((kind) => {
    const xs = decided.filter((m) => m.prediction!.kind === kind);
    return { kind, n: xs.length, right: xs.filter((m) => (m.prediction!.pRed > 0.5) === (m.red.score!.total > m.blue.score!.total)).length };
  }).filter((x) => x.n > 0);
}

/** The right side of the hero: what a visitor came to learn, at a glance — real data only. */
function EventGlance({ d, onTab }: { d: EventDetail; onTab: (t: string) => void }) {
  const e = d.event;
  const winners = d.awards.filter((a) => a.type === "Winner").map((a) => a.team);
  const seed1 = d.field.find((f) => f.rank === 1) ?? null;
  const topOpr = [...d.field].filter((f) => f.opr.np != null).sort((a, b) => b.opr.np! - a.opr.np!)[0] ?? null;
  const record = callRecord(d.matches);
  const rows: { label: string; value: ReactNode; to?: string; tab?: string }[] = [];
  if (winners.length) rows.push({ label: "Won by", value: <span className="font-mono">{winners.join(" · ")}</span>, tab: "playoffs" });
  if (seed1) rows.push({ label: "#1 seed", value: <><span className="font-mono">{seed1.team}</span> <span className="text-muted-foreground">{seed1.name}</span></>, to: `/teams/${seed1.team}?season=${e.season}`, tab: "rankings" });
  if (topOpr) rows.push({ label: "Top OPR", value: <><span className="font-mono">{topOpr.team}</span> <span className="text-muted-foreground">{topOpr.opr.np!.toFixed(1)}</span></>, to: `/teams/${topOpr.team}?season=${e.season}` });
  if (d.advancement?.slots) rows.push({ label: "Advancing", value: <>{d.advancement.slots} slots{d.advancement.advancesTo ? <span className="text-muted-foreground"> → {d.advancement.advancesTo}</span> : null}</>, tab: "odds" });
  return (
    <div className="min-w-0 rounded-xl border border-border/70 bg-background/40 p-4 backdrop-blur-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">At a glance</p>
      {record.length > 0 ? (
        // Live calls and backtest replays are never blended: one line each, named.
        <button type="button" onClick={() => onTab("matches")} className="mt-2 block w-full space-y-1 text-left">
          {record.map((x, i) => (
            <span key={x.kind} className="block">
              <span className={cn("font-display font-semibold tabular-nums", i === 0 ? "text-3xl text-accent" : "text-lg")}>{Math.round((x.right / x.n) * 100)}%</span>
              <span className="ml-2 text-sm text-muted-foreground">of {x.n} {x.kind === "live" ? "calls made before the match" : "matches predicted from earlier data (replayed)"}</span>
            </span>
          ))}
        </button>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          {e.status === "upcoming" ? "Every match here gets a prediction before it's played, scored afterwards on the public track record." : "No decided matches with predictions here yet."}
        </p>
      )}
      {rows.length > 0 && (
        <dl className="mt-3 divide-y divide-border/60 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3 py-2">
              <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 truncate text-right">
                {r.to ? <Link to={r.to} className="hover:text-accent">{r.value}</Link> : r.tab ? <button type="button" onClick={() => onTab(r.tab!)} className="hover:text-accent">{r.value}</button> : r.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {e.status !== "finished" && !d.forecastUnsupported && (
        <Button size="sm" className="mt-3 w-full" onClick={() => onTab("odds")}><Trophy /> Who advances? See the odds</Button>
      )}
    </div>
  );
}

function Matches({ d, team }: { d: EventDetail; team: number | null }) {
  const [level, setLevel] = useState<"all" | "qual" | "playoff">("all");
  const [onlyTeam, setOnlyTeam] = useState(!!team);
  const list = d.matches.filter((m: MatchView) => (level === "all" || m.level === level) && (!onlyTeam || !team || [...m.red.teams, ...m.blue.teams].some((t) => t.number === team)));
  const record = callRecord(d.matches);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup type="single" value={level} onValueChange={(v) => { if (v) setLevel(v as typeof level); }} aria-label="Match level">
          <ToggleGroupItem value="all">All</ToggleGroupItem><ToggleGroupItem value="qual">Quals</ToggleGroupItem><ToggleGroupItem value="playoff">Playoffs</ToggleGroupItem>
        </ToggleGroup>
        {team && <Button size="sm" variant={onlyTeam ? "secondary" : "outline"} onClick={() => setOnlyTeam(!onlyTeam)}>{onlyTeam ? `Only ${team}` : `Highlight ${team}`}</Button>}
        {record.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{record.map((x) => `${x.kind === "live" ? "Live calls" : "Predicted"} ${x.right}/${x.n} right (${Math.round((x.right / x.n) * 100)}%)`).join(" · ")}</span>}
      </div>
      {!d.matches.length ? <EmptyState icon={Swords} title="No schedule yet" description="The match schedule appears here once FIRST publishes it (usually the morning of the event)." /> : <MatchList matches={list} highlight={team ?? undefined} empty="No matches in this view." />}
      <p className="text-xs text-muted-foreground">Played matches show the prediction logged before they were played (or, for past seasons, the prediction replayed from the matches before it). Upcoming matches show odds from today's ratings.</p>
    </div>
  );
}

function Rankings({ field, season, team, code }: { field: FieldRow[]; season: number; team: number | null; code: string }) {
  const cols: Col<FieldRow>[] = [
    { key: "rank", label: "Rank", value: (r) => r.rank, asc: true, align: "right", render: (r) => r.rank ?? "—" },
    { key: "team", label: "Team", value: (r) => r.team, render: (r) => <Link to={`/teams/${r.team}?season=${season}`} className="hover:underline"><span className="font-mono font-medium">{r.team}</span> <span className="text-muted-foreground">{r.name}</span></Link> },
    { key: "rs", label: "RS", title: "Ranking score (average ranking points)", value: (r) => r.rp, align: "right", render: (r) => num(r.rp, 2) },
    { key: "wlt", label: "W-L-T", value: (r) => (r.wins ?? 0) - (r.losses ?? 0), align: "right", render: (r) => `${r.wins ?? "–"}-${r.losses ?? "–"}-${r.ties ?? "–"}` },
    { key: "opr", label: "OPR", value: (r) => r.opr.np, align: "right", render: (r) => num(r.opr.np) },
    { key: "auto", label: "Auto", value: (r) => r.opr.auto, align: "right", render: (r) => num(r.opr.auto), hideOnMobile: true },
    { key: "teleop", label: "TeleOp", value: (r) => r.opr.teleop, align: "right", render: (r) => num(r.opr.teleop), hideOnMobile: true },
    { key: "endgame", label: "Endgame", value: (r) => r.opr.endgame, align: "right", render: (r) => num(r.opr.endgame), hideOnMobile: true },
    { key: "pen", label: "Pen.", title: "Penalty points given away per match (OPR)", value: (r) => r.opr.pen, asc: true, align: "right", render: (r) => num(r.opr.pen), hideOnMobile: true },
    { key: "rating", label: "Rating", title: "Prediction rating now (± uncertainty)", value: (r) => r.rating?.np ?? null, align: "right", render: (r) => r.rating ? <span>{num(r.rating.np)} <span className="text-muted-foreground">±{num(r.rating.sd, 0)}</span></span> : "—" },
  ];
  return <SortTable rows={field} cols={cols} rowKey={(r) => r.team} initial={{ key: "rank", dir: "asc" }} csvName={`${code}-${season}-rankings`} highlight={(r) => r.team === team} empty="No teams registered yet." />;
}

function slotLabel(s: Slot): string {
  if ("seed" in s) return `Seed ${s.seed}`;
  if ("winnerOf" in s) return `Winner M${s.winnerOf}`;
  return `Loser M${s.loserOf}`;
}

function Playoffs({ d }: { d: EventDetail }) {
  const al = d.alliances;
  if (!al.length) return <EmptyState icon={Trophy} title="Alliances not selected yet" description="Alliance selection happens after qualification matches." />;
  const playoff = d.matches.filter((m) => m.level === "playoff");
  const bracket = BRACKETS[al.length];
  const bySeries = new Map<number, MatchView[]>();
  for (const m of playoff) bySeries.set(m.series, [...(bySeries.get(m.series) ?? []), m]);
  const allianceOf = (teams: number[]) => al.find((a) => [a.captain, a.pick1, a.pick2, a.backup].some((t) => t && teams.includes(t)))?.number;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {al.map((a) => (
          <div key={a.number} className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Alliance {a.number}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[a.captain, a.pick1, a.pick2, a.backup].filter((t): t is number => t != null).map((t, i) => (
                <Link key={t} to={`/teams/${t}?season=${d.event.season}`} className={cn("rounded-md px-2 py-0.5 font-mono text-sm", i === 0 ? "bg-accent text-accent-ink" : "bg-muted")}>{t}</Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      {bracket ? (
        <div>
          <h3 className="mb-3 text-base font-semibold">Double-elimination bracket</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {bracket.matches.map((bm, i) => {
              const ms = bySeries.get(i + 1) ?? [];
              const last = ms.filter((m) => m.played).at(-1);
              const winnerAl = last && last.red.score && last.blue.score ? allianceOf((last.red.score.total > last.blue.score.total ? last.red : last.blue).teams.map((t) => t.number)) : null;
              const isFinal = i === bracket.matches.length - 1;
              return (
                <div key={i} className={cn("rounded-xl border border-border bg-card p-3", isFinal && "border-accent/40")}>
                  <p className="text-xs font-medium text-muted-foreground">M{i + 1}{isFinal ? " · Grand final" : ""}</p>
                  <p className="mt-1 text-sm">{slotLabel(bm.red)} <span className="text-muted-foreground">vs</span> {slotLabel(bm.blue)}</p>
                  {ms.length ? ms.map((m) => (
                    <p key={m.key} className="mt-1 text-xs tabular-nums text-muted-foreground">{m.label}: {m.played && m.red.score && m.blue.score ? <><span className="text-red-alliance">{m.red.score.total}</span>–<span className="text-blue-alliance">{m.blue.score.total}</span></> : "not played yet"}</p>
                  )) : <p className="mt-1 text-xs text-muted-foreground">Not scheduled yet</p>}
                  {winnerAl && <Badge variant="soft" className="mt-2"><Trophy /> Alliance {winnerAl}</Badge>}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      <MatchList matches={playoff} empty="No playoff matches yet." />
    </div>
  );
}

function Awards({ d, nameOf }: { d: EventDetail; nameOf: (t: number) => string }) {
  const s = d.event.season;
  return (
    <div className="space-y-6">
      {!d.awards.length ? <EmptyState icon={Award} title="No awards published yet" description="Awards appear after the closing ceremony." /> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {d.awards.map((a) => (
            <li key={`${a.type}${a.placement}${a.team}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <Award className="size-5 shrink-0 text-accent" />
              <div className="min-w-0"><p className="text-sm font-medium">{a.name ?? awardLabel(a.type, a.placement)}</p><Link to={`/teams/${a.team}?season=${s}`} className="text-sm text-muted-foreground hover:underline"><span className="font-mono">{a.team}</span> {nameOf(a.team)}</Link></div>
            </li>
          ))}
        </ul>
      )}
      {d.advancement && (
        <div>
          <h3 className="mb-2 text-base font-semibold">Advancement <span className="text-sm font-normal text-muted-foreground">· {d.advancement.slots} slots{d.advancement.advancesTo ? ` to ${d.advancement.advancesTo}` : ""}</span></h3>
          <div className="flex flex-wrap gap-2">
            {d.advancement.rows.map((r) => (
              <Link key={r.team} to={`/teams/${r.team}?season=${s}`} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm hover:border-accent/40">
                <span className="font-mono">{r.team}</span> <span className="text-xs text-muted-foreground">{r.status === "FIRST" ? "advanced" : r.status === "ALREADY_ADVANCING" ? "already qualified" : r.status.toLowerCase()}{r.declined ? " · declined" : ""}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
