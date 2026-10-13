// Prediction lab: what-if alliances, advancement for any team at any event,
// and the real upcoming matches. Every output carries its confidence tier.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, BookmarkPlus, CalendarDays, Link2, Sparkles, Swords, Trophy } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventSummary, MatchExplanationView, MatchView } from "../shared/api";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Async, ErrorState } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge, Input } from "../components/ui/basic";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { toast } from "../components/ui/sonner";
import { CalibrationLine, ConfidenceBadge, FactorList, MatchList, WinBar } from "../components/predict";
import { TeamInput } from "../components/TeamInput";
import { SeasonToggle } from "../components/SeasonToggle";
import { AdvancementView } from "../components/Advancement";
import { cn } from "../components/cn";
import { dateRange, num, oddsPct, seasonLabel } from "../lib/format";

type Mode = "match" | "advancement" | "upcoming";

export default function PredictPage() {
  useTitle("Prediction lab");
  const [sp, setSp] = useSearchParams();
  const mode = (sp.get("mode") as Mode) || "match";
  const setMode = (m: string) => setSp((x) => { x.set("mode", m); return x; }, { replace: true });
  return (
    <div>
      <PageHeader title="Prediction lab" description={<>Win odds for any alliance against any other, and advancement odds for any team at any event. Every number comes with its confidence — and the <Link to="/predict/accuracy" className="underline">track record</Link> shows how often they've been right.</>} />
      <Tabs value={mode} onValueChange={setMode}>
        <TabsList>
          <TabsTrigger value="match"><Swords className="size-4" /> Match</TabsTrigger>
          <TabsTrigger value="advancement"><Trophy className="size-4" /> Advancement</TabsTrigger>
          <TabsTrigger value="upcoming"><CalendarDays className="size-4" /> Upcoming</TabsTrigger>
        </TabsList>
        <TabsContent value="match" className="mt-6"><MatchLab /></TabsContent>
        <TabsContent value="advancement" className="mt-6"><AdvancementLab /></TabsContent>
        <TabsContent value="upcoming" className="mt-6"><Upcoming /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Match: what-if alliances
// ---------------------------------------------------------------------------

function MatchLab() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const season = Number(sp.get("season")) || current;
  const init = (k: string) => (sp.get(k) ?? "").split(",").filter(Boolean);
  const [red, setRed] = useState<string[]>(() => { const x = init("red"); return [x[0] ?? "", x[1] ?? ""]; });
  const [blue, setBlue] = useState<string[]>(() => { const x = init("blue"); return [x[0] ?? "", x[1] ?? ""]; });
  const ready = red.every((x) => x) && blue.every((x) => x);
  const query = ready ? `/api/predict/match${qs({ season, red: red.join(","), blue: blue.join(",") })}` : null;
  const [submitted, setSubmitted] = useState<string | null>(ready ? query : null);
  const state = useApi<MatchExplanationView>(submitted);
  const run = () => {
    if (!ready) return;
    setSubmitted(query);
    setSp((x) => { x.set("mode", "match"); x.set("season", String(season)); x.set("red", red.join(",")); x.set("blue", blue.join(",")); return x; }, { replace: true });
  };
  const swap = () => { setRed(blue); setBlue(red); };
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <SeasonToggle value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />
          <span className="text-xs text-muted-foreground">Ratings as of now for {seasonLabel(season)}</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); run(); }} className="grid items-start gap-4 md:grid-cols-[1fr_auto_1fr]">
          <fieldset className="rounded-xl border border-red-alliance/30 bg-red-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-red-alliance">Red alliance</legend>
            <div className="grid grid-cols-2 gap-3">{red.map((v, i) => <TeamInput key={i} label={`Red team ${i + 1}`} tone="red" value={v} onChange={(x) => setRed((r) => r.map((y, j) => (j === i ? x : y)))} autoFocus={i === 0 && !v} />)}</div>
          </fieldset>
          <div className="flex justify-center md:pt-8"><Button type="button" variant="ghost" size="icon" onClick={swap} aria-label="Swap alliances"><ArrowLeftRight /></Button></div>
          <fieldset className="rounded-xl border border-blue-alliance/30 bg-blue-alliance/[0.04] p-4">
            <legend className="px-1 text-sm font-semibold text-blue-alliance">Blue alliance</legend>
            <div className="grid grid-cols-2 gap-3">{blue.map((v, i) => <TeamInput key={i} label={`Blue team ${i + 1}`} tone="blue" value={v} onChange={(x) => setBlue((r) => r.map((y, j) => (j === i ? x : y)))} />)}</div>
          </fieldset>
          <div className="md:col-span-3"><Button type="submit" size="lg" disabled={!ready} className="w-full sm:w-auto"><Sparkles /> Predict this match</Button></div>
        </form>
      </div>
      {submitted && (state.error ? <ErrorState error={state.error} onRetry={state.reload} /> : !state.data ? <div className="skeleton h-72 rounded-2xl" /> : <MatchResult x={state.data} />)}
      {!submitted && <EmptyState icon={Swords} title="Pick four teams" description="Any teams, any season — a real matchup or a what-if. You'll get win odds, predicted scores with ranges, the three biggest reasons, and how confident the call is." />}
      <SavedPredictions />
    </div>
  );
}

function MatchResult({ x }: { x: MatchExplanationView }) {
  const { update } = usePersonal();
  const fav = x.winProbRed >= 0.5 ? "Red" : "Blue";
  const save = () => {
    update("predictionHistory", (h) => [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, season: x.season, red: x.red, blue: x.blue, winProbRed: x.winProbRed, predictedRed: x.predictedRed, predictedBlue: x.predictedBlue, tier: x.confidence.tier, savedAt: Date.now() }, ...h].slice(0, 200));
    toast.success("Saved to your predictions");
  };
  const share = () => { navigator.clipboard?.writeText(location.href).then(() => toast.success("Link copied"), () => toast.error("Couldn't copy the link")); };
  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ConfidenceBadge tier={x.confidence.tier} reason={x.confidence.reason} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={share}><Link2 /> Share</Button>
            <Button variant="secondary" size="sm" onClick={save}><BookmarkPlus /> Save</Button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-end gap-4">
          <div><p className="text-sm font-medium text-red-alliance">Red {x.red.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-red-alliance sm:text-6xl">{oddsPct(x.winProbRed)}</p></div>
          <p className="pb-3 text-sm text-muted-foreground">to win</p>
          <div className="text-right"><p className="text-sm font-medium text-blue-alliance">Blue {x.blue.join(" + ")}</p><p className="font-display text-5xl font-semibold tabular-nums text-blue-alliance sm:text-6xl">{oddsPct(x.winProbBlue)}</p></div>
        </div>
        <WinBar pRed={x.winProbRed} className="mt-4" />
        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold tabular-nums">{x.predictedRed}</p><p className="text-xs text-muted-foreground">80% of the time between {x.rangeRed[0]} and {x.rangeRed[1]}</p></div>
          <div className="text-right"><p className="text-muted-foreground">Predicted score</p><p className="font-display text-2xl font-semibold tabular-nums">{x.predictedBlue}</p><p className="text-xs text-muted-foreground">80% of the time between {x.rangeBlue[0]} and {x.rangeBlue[1]}</p></div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{fav} is favoured — not certain. This is a probability from current ratings, including penalties each side tends to give away.</p>
        <CalibrationLine pRed={x.winProbRed} className="mt-2" />
        {/* Made to be screenshotted: the card says where it came from. */}
        <div className="mt-5 flex items-center justify-between border-t border-border pt-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><img src="/logo.svg" alt="" className="size-4" /> FTC Control Scout · prediction lab</span>
          <span>{seasonLabel(x.season)} · engine v{x.engineVersion}</span>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base font-semibold">Why — the top 3 factors</h3>
          <FactorList factors={x.factors} />
          <p className="mt-3 text-xs text-muted-foreground">Factors are an exact split of the predicted margin by game phase. <Link to="/methodology#factors" className="underline">More</Link></p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="mb-3 text-base font-semibold">The robots</h3>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground"><th className="pb-2">Team</th><th className="pb-2 text-right">Adds</th><th className="pb-2 text-right">Auto</th><th className="pb-2 text-right">Tele</th><th className="pb-2 text-right">End</th><th className="pb-2 text-right">Matches</th></tr></thead>
            <tbody>
              {[...x.teamsRed.map((t) => ({ ...t, side: "red" })), ...x.teamsBlue.map((t) => ({ ...t, side: "blue" }))].map((t) => (
                <tr key={t.team} className="border-t border-border">
                  <td className="py-1.5"><Link to={`/teams/${t.team}?season=${x.season}`} className={cn("font-mono hover:underline", t.side === "red" ? "text-red-alliance" : "text-blue-alliance")}>{t.team}</Link> <span className="text-xs text-muted-foreground">{t.name}</span></td>
                  <td className="text-right tabular-nums">{num(t.np, 0)}<span className="text-xs text-muted-foreground"> ±{num(t.sd, 0)}</span></td>
                  <td className="text-right tabular-nums">{num(t.auto, 0)}</td><td className="text-right tabular-nums">{num(t.teleop, 0)}</td><td className="text-right tabular-nums">{num(t.endgame, 0)}</td>
                  <td className="text-right tabular-nums">{t.matches}{t.matches < 3 && <Badge variant="outline" className="ml-1">few</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SavedPredictions() {
  const { state, update } = usePersonal();
  const h = state.predictionHistory;
  if (!h.length) return null;
  return (
    <Section title="Your saved predictions" description="Saved on this device (and your account, when signed in)." action={<Button variant="ghost" size="sm" onClick={() => update("predictionHistory", () => [])}>Clear</Button>}>
      <ul className="grid gap-2 sm:grid-cols-2">
        {h.slice(0, 12).map((p) => (
          <li key={p.id}>
            <Link to={`/predict?mode=match&season=${p.season}&red=${p.red.join(",")}&blue=${p.blue.join(",")}`} className="lift block rounded-xl border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2"><span><span className="text-red-alliance">{p.red.join("+")}</span> vs <span className="text-blue-alliance">{p.blue.join("+")}</span></span><span className="text-xs text-muted-foreground">{seasonLabel(p.season)}</span></div>
              <WinBar pRed={p.winProbRed} size="sm" className="mt-2" />
              <p className="mt-1 text-xs text-muted-foreground">Red {oddsPct(p.winProbRed)} · {p.predictedRed}–{p.predictedBlue} · {p.tier} · saved {new Date(p.savedAt).toLocaleDateString()}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Advancement: any team, any event
// ---------------------------------------------------------------------------

function AdvancementLab() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const { state: personal } = usePersonal();
  const season = Number(sp.get("season")) || current;
  const code = sp.get("code");
  const team = Number(sp.get("team")) || null;
  const [teamText, setTeamText] = useState(team ? String(team) : personal.myTeam ? String(personal.myTeam) : "");
  useEffect(() => { if (team) setTeamText(String(team)); }, [team]);
  const set = (k: string, v: string | null) => setSp((x) => { x.set("mode", "advancement"); if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  const teamEvents = useApi<{ events: { code: string; name: string; start: string | null; type: string | null }[] }>(teamText.length >= 1 ? `/api/teams/${teamText}${qs({ season })}` : null);
  const [q, setQ] = useState("");
  const events = useApi<{ events: EventSummary[] }>(`/api/events${qs({ season })}`);
  const advancing = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);
  const choices = useMemo(() => {
    const all = (events.data?.events ?? []).filter((e) => advancing.has(e.type ?? ""));
    const mine = new Set((teamEvents.data?.events ?? []).map((e) => e.code));
    const needle = q.trim().toLowerCase();
    return all.filter((e) => !needle || `${e.name} ${e.code} ${e.city ?? ""}`.toLowerCase().includes(needle)).sort((a, b) => Number(mine.has(b.code)) - Number(mine.has(a.code)) || (a.start ?? "").localeCompare(b.start ?? ""));
  }, [events.data, teamEvents.data, q]);
  const myCodes = new Set((teamEvents.data?.events ?? []).map((e) => e.code));
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center gap-3"><SeasonToggle value={season} onChange={(s) => { set("season", String(s)); set("code", null); }} /></div>
        <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
          <div>
            <TeamInput label="Team" value={teamText} onChange={(v) => { setTeamText(v); set("team", v || null); }} />
          </div>
          <div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an event (the team's events are listed first)" className="h-11" aria-label="Find an event" />
            <div className="custom-scrollbar mt-2 max-h-56 space-y-1 overflow-y-auto">
              {events.error ? <p className="text-sm text-destructive">{events.error.message}</p> : !events.data ? <div className="skeleton h-24 rounded-lg" /> : !choices.length ? <p className="py-4 text-sm text-muted-foreground">No advancing events {q ? "match" : `in ${seasonLabel(season)} yet`}.</p> : choices.slice(0, 60).map((e) => (
                <button key={e.code} onClick={() => set("code", e.code)} className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm", code === e.code ? "border-accent/60 bg-accent/[0.06]" : "border-transparent hover:bg-text-base/[0.04]")}>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  {myCodes.has(e.code) && <Badge variant="soft">{teamText}'s event</Badge>}
                  <span className="shrink-0 text-xs text-muted-foreground">{dateRange(e.start, e.end)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {code ? <AdvancementView season={season} code={code} team={team} nameOf={() => ""} onPickTeam={(t) => { setTeamText(String(t)); set("team", String(t)); }} />
        : <EmptyState icon={Trophy} title="Pick an event" description="Any qualifier, league tournament or championship. Add a team to see its chance to advance, captain and pick odds, likely rank, and expected advancement points." />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upcoming real matches
// ---------------------------------------------------------------------------

function Upcoming() {
  const season = useCurrentSeason();
  const state = useApi<{ matches: MatchView[] }>(`/api/predict/upcoming${qs({ season })}`);
  return (
    <Async state={state} empty={(d) => !d.matches.length && <EmptyState icon={CalendarDays} title="No scheduled matches in the next week" description="Predictions for real matches appear as soon as an event publishes its schedule (usually the morning of the event). Meanwhile, try a what-if in the Match tab." />}>
      {(d) => {
        const byEvent = new Map<string, MatchView[]>();
        for (const m of d.matches) byEvent.set(m.code, [...(byEvent.get(m.code) ?? []), m]);
        return <div>{[...byEvent.entries()].map(([c, ms]) => (
          <Section key={c} title={<Link to={`/events/${season}/${c}`} className="hover:underline">{c}</Link>} description={`${ms.length} upcoming`}>
            <MatchList matches={ms} />
          </Section>
        ))}</div>;
      }}
    </Async>
  );
}
