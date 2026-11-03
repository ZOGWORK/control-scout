// Scout → Pick helper: the partners at an event that fill your alliance's gaps (src/shared/pickRadar.ts).
// Your team (and a partner already picked) on a radar of Auto, TeleOp, Endgame and Few fouls, then the
// partners whose alliance covers the most of it, each with its radar over yours and what it adds. Ratings
// are the engine's, as stored by the stats job (GET /api/events/:season/:code/pick-ratings); the radar math
// runs here. Choices live in the URL (?pteam, ?pwith, ?ptaken, ?psize), so a link opens the same view.
import { useEffect, useMemo, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarSearch, Check, Plus, Radar, RefreshCw, Undo2, X } from "lucide-react";
import { useApi } from "../../../lib/api";
import { EmptyState } from "../../page";
import { LoadingBlock } from "../../states";
import { Button } from "../../ui/button";
import { Badge, Card } from "../../ui/basic";
import { Collapsible, CollapsibleContent, CollapsibleTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, ToggleGroup, ToggleGroupItem } from "../../ui/controls";
import { PickRadar } from "./PickRadar";
import {
  allianceOf, alliancePicked, PICK_AXES, PICK_AXIS_LABEL, PICK_LIMIT, pts, suggestPartners,
  type Axes, type PickRatings, type PickSuggestion, type PickTeam,
} from "../../../shared/pickRadar";

const NONE: PickRatings["alliances"] = [];
const list = (v: string | null) => [...new Set((v ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
const pct = (x: number) => `${Math.round(x * 100)}%`;
const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function PickHelper({ season, eventCode, myTeam, onPickEvent }: {
  season: number;
  eventCode: string | null;
  /** The team this device follows (Settings → My team): the default. */
  myTeam: number | null;
  /** Choose the event (Event day's picker). */
  onPickEvent: (() => void) | null;
}) {
  const [sp, setSp] = useSearchParams();
  const data = useApi<PickRatings>(eventCode ? `/api/events/${season}/${encodeURIComponent(eventCode)}/pick-ratings` : null);
  // Alliance selection posts while the page is open: asked again every minute while it's on screen (the server
  // keeps the answer per data version, so a repeat is cheap), and on Refresh.
  const reload = useRef(data.reload);
  reload.current = data.reload;
  useEffect(() => {
    if (!eventCode) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload.current(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [eventCode]);
  if (!eventCode) {
    return <EmptyState icon={CalendarSearch} title="Choose an event first" description="The pick helper works from the teams at one event."
      action={onPickEvent && <Button variant="outline" onClick={onPickEvent}>Choose event</Button>} />;
  }
  if (data.error && !data.data) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
        <span className="min-w-0 flex-1 text-danger-text">Couldn't load the ratings. {data.error.message}</span>
        <Button size="sm" variant="outline" onClick={() => void data.reload()}>Retry</Button>
      </div>
    );
  }
  if (!data.data) return <LoadingBlock rows={3} label="Loading ratings" />;
  return <PickBoard d={data.data} myTeam={myTeam} sp={sp} setSp={setSp} onRefresh={() => void data.reload()} />;
}

/** How often an open pick helper asks for the posted alliances again. */
export const REFRESH_MS = 60_000;

function PickBoard({ d, myTeam, sp, setSp, onRefresh }: {
  d: PickRatings;
  myTeam: number | null;
  sp: URLSearchParams;
  setSp: ReturnType<typeof useSearchParams>[1];
  onRefresh: () => void;
}) {
  const by = useMemo(() => new Map(d.teams.map((t) => [t.team, t])), [d.teams]);
  const asked = Number(sp.get("pteam"));
  const me = by.has(asked) ? asked : myTeam != null && by.has(myTeam) ? myTeam : null;
  const size = sp.get("psize") === "3" ? 3 : sp.get("psize") === "2" ? 2 : d.size;
  // Posted alliances count unless switched off (to plan as before selection, or replay a past event).
  const usePosted = sp.get("pposted") !== "0";
  const alliances = usePosted ? d.alliances : NONE;
  const posted = me != null ? allianceOf(alliances, me) : null;
  const picked = useMemo(() => alliancePicked(alliances), [alliances]);
  const taken = list(sp.get("ptaken")).filter((t) => by.has(t));
  // Partners you added (not posted yet): only teams still free.
  const added = posted ? [] : list(sp.get("pwith")).filter((t) => by.has(t) && t !== me && !picked.has(t)).slice(0, size - 1);
  const members = me == null ? [] : posted ?? [me, ...added];
  // A posted partner with no rating yet can't go on the chart: said so, never counted as zero.
  const unratedHere = members.filter((t) => !by.has(t));
  const set = (k: string, v: string | null) => setSp((x) => { if (v) x.set(k, v); else x.delete(k); return x; }, { replace: true });
  // A few dozen areas at most: cheap enough to work out on every render.
  const view = me == null ? null : suggestPartners({ teams: d.teams, members, unavailable: [...picked, ...taken], size });

  if (!d.teams.length) {
    return <EmptyState icon={Radar} title="No ratings here yet" description={`None of the teams at ${d.name} has a rating for this season yet, so there's nothing to compare.`} />;
  }
  const nameOf = (t: number) => by.get(t)?.name ?? null;
  const teamPicker = (
    <Select value={me != null ? String(me) : undefined} onValueChange={(v) => setSp((x) => { x.set("pteam", v); x.delete("pwith"); return x; }, { replace: true })}>
      <SelectTrigger aria-label="Your team" className="w-[min(100%,16rem)] max-sm:h-11"><SelectValue placeholder="Choose your team" /></SelectTrigger>
      <SelectContent>
        {[...d.teams].sort((a, b) => a.team - b.team).map((t) => <SelectItem key={t.team} value={String(t.team)}>{t.team}{t.name ? ` ${t.name}` : ""}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {teamPicker}
        <ToggleGroup type="single" variant="chips" value={String(size)} aria-label="Teams per alliance" onValueChange={(v) => { if (v) set("psize", v === String(d.size) ? null : v); }}>
          <ToggleGroupItem value="2" className="max-sm:h-11">2 teams</ToggleGroupItem>
          <ToggleGroupItem value="3" className="max-sm:h-11">3 teams</ToggleGroupItem>
        </ToggleGroup>
        {d.alliances.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={usePosted} onCheckedChange={(on) => set("pposted", on ? null : "0")} />
            Use the {d.alliances.length} posted alliances
          </label>
        ) : <span className="text-xs text-muted-foreground">No alliances posted at {d.name} yet</span>}
        <Button size="sm" variant="ghost" className="text-muted-foreground max-sm:h-10" onClick={onRefresh}><RefreshCw /> Refresh</Button>
      </div>

      {me == null || !view ? (
        <EmptyState icon={Radar} title="Choose your team" description="See which partners here fill your alliance's gaps." />
      ) : <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Card className="gap-2 p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="mr-1 text-sm font-semibold">Your alliance</h3>
              {members.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-sm">
                  {t}
                  {!posted && t !== me && (
                    <button type="button" aria-label={`Remove ${t}`} className="-mr-1 grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                      onClick={() => set("pwith", added.filter((x) => x !== t).join(",") || null)}><X className="size-3.5" /></button>
                  )}
                </span>
              ))}
              {posted && <Badge variant="secondary">As posted</Badge>}
            </div>
            <PickRadar current={view.current.axes} label={`Your alliance: ${axesWords(view.current.axes)}`} className="mx-auto w-full max-w-[17rem]" />
            <p className="text-center text-sm"><span className="font-semibold tabular-nums">{pct(view.current.share)}</span> <span className="text-muted-foreground">of the chart covered</span></p>
            {unratedHere.length > 0 && (
              <p role="note" className="text-center text-xs text-warning-text">{unratedHere.join(", ")} {unratedHere.length > 1 ? "have" : "has"} no rating yet, so the chart counts only {members.filter((t) => by.has(t)).join(", ")}.</p>
            )}
          </Card>
          {view.suggestions.map((s, i) => (
            <SuggestionCard key={s.team.team} s={s} place={i + 1} current={view.current.share} currentAxes={view.current.axes} me={me}
              canAdd={!posted && members.length + 1 < size}
              onAdd={() => set("pwith", [...added, s.team.team].join(","))}
              onTaken={() => set("ptaken", [...taken, s.team.team].join(","))} />
          ))}
        </div>
        {!view.suggestions.length && (
          <p className="text-sm text-muted-foreground">{members.length < size ? "No rated teams left to suggest."
            : posted ? "Your alliance is set as posted. Turn off the posted alliances to plan it from the start."
            : `Your alliance has ${size} teams. Remove a partner to see others.`}</p>
        )}
        {taken.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">Marked taken:</span>
            {taken.map((t) => (
              <Button key={t} size="sm" variant="outline" className="h-8 font-mono" aria-label={`Put ${t} back`} onClick={() => set("ptaken", taken.filter((x) => x !== t).join(",") || null)}>{t} <Undo2 /></Button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Top {PICK_LIMIT} of {view.pool} teams still free{picked.size ? ` (teams on a posted alliance left out)` : ""}{d.unrated.length ? `. ${d.unrated.length} with no rating yet aren't suggested` : ""}.
          {" "}Season ratings, the same ones predictions use. A guide to gaps, not a prediction. <Link to="/methodology#pick-helper" className="font-medium text-accent-text hover:underline">How it works</Link>
        </p>
        <Inputs d={d} members={members} suggestions={view.suggestions} scale={view.scale} nameOf={nameOf} />
      </>}
    </div>
  );
}

const axesWords = (a: Record<string, number>) => PICK_AXES.map((k) => `${PICK_AXIS_LABEL[k]} ${pts(a[k])}`).join(", ");

function SuggestionCard({ s, place, current, currentAxes, me, canAdd, onAdd, onTaken }: {
  s: PickSuggestion; place: number; current: number; currentAxes: Axes; me: number; canAdd: boolean; onAdd: () => void; onTaken: () => void;
}) {
  const t = s.team;
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-start gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-ink tabular-nums">{place}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm"><Link to={`/teams/${t.team}`} className="font-mono font-bold hover:underline">{t.team}</Link>{t.name && <span className="ml-1.5 text-muted-foreground">{t.name}</span>}</h3>
          <p className="text-xs text-muted-foreground">{s.ratingPlace === 1 ? "Highest rated left" : `#${s.ratingPlace} by rating`}{t.rank != null ? ` · ranked ${t.rank}` : ""}{t.matches < 6 ? ` · ${t.matches} matches rated` : ""}</p>
        </div>
      </div>
      <PickRadar current={currentAxes} result={s.result.axes} label={`${me} with ${t.team}: ${axesWords(s.result.axes)}`} className="mx-auto w-full max-w-[17rem]" />
      <p className="text-center text-sm"><span className="font-semibold tabular-nums">{pct(s.result.share)}</span> <span className="text-muted-foreground">covered, up from {pct(current)}</span></p>
      <div className="flex flex-wrap justify-center gap-1.5" aria-label="What it adds">
        {s.gains.length ? s.gains.slice(0, 3).map((g) => <Badge key={g.axis} variant="soft" className="tabular-nums">{PICK_AXIS_LABEL[g.axis]} +{g.points}</Badge>)
          : <span className="text-xs text-muted-foreground">Adds little on any axis</span>}
        {s.costs.map((g) => <Badge key={g.axis} variant="secondary" className="tabular-nums">{PICK_AXIS_LABEL[g.axis]} {g.points}</Badge>)}
      </div>
      <div className="mt-1 flex gap-2">
        {canAdd && <Button size="sm" variant="outline" className="flex-1 max-sm:h-10" onClick={onAdd} aria-label={`Add ${t.team} to your alliance`}><Plus /> Add</Button>}
        <Button size="sm" variant="outline" className="flex-1 max-sm:h-10" onClick={onTaken} aria-label={`Mark ${t.team} taken`}><Check /> Taken</Button>
      </div>
    </Card>
  );
}

/** Every number above, from its inputs: each team's ratings, the alliance totals and what each axis is measured against. */
function Inputs({ d, members, suggestions, scale, nameOf }: {
  d: PickRatings; members: number[]; suggestions: PickSuggestion[]; scale: { size: number; auto: number; teleop: number; endgame: number; fouls: number }; nameOf: (t: number) => string | null;
}) {
  const by = new Map(d.teams.map((t) => [t.team, t]));
  const rows: { t: PickTeam; mine: boolean }[] = [
    ...members.map((m) => ({ t: by.get(m)!, mine: true })),
    ...suggestions.map((s) => ({ t: s.team, mine: false })),
  ].filter((r) => r.t);
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button variant="outline" size="sm" className="justify-self-start max-sm:h-10">Show the numbers</Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 grid gap-3">
        <p className="text-sm text-muted-foreground">
          Axis = alliance total ÷ the best {scale.size} teams here added up (Few fouls: 1 − fouls total ÷ the {scale.size} most-fouling teams added up), as 0–100.
          Area = ½·sin(2π/4)·Σ rᵢ·rᵢ₊₁ around Auto → TeleOp → Endgame → Few fouls; covered = area ÷ the full chart's 2.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Ratings used (points a match)</caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 text-left font-medium">Team</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Auto</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">TeleOp</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Endgame</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Fouls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ t, mine }) => (
                <tr key={t.team} className="border-b border-border last:border-0">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal"><span className="font-mono font-semibold">{t.team}</span>{mine && <span className="ml-1.5 text-xs text-muted-foreground">yours</span>}<span className="sr-only">{nameOf(t.team) ? ` ${nameOf(t.team)}` : ""}</span></th>
                  <td className="px-3 py-1.5 text-right">{r1(t.auto)}</td>
                  <td className="px-3 py-1.5 text-right">{r1(t.teleop)}</td>
                  <td className="px-3 py-1.5 text-right">{r1(t.endgame)}</td>
                  <td className="px-3 py-1.5 text-right">{r1(t.fouls)}</td>
                </tr>
              ))}
              <tr className="bg-muted/50 text-muted-foreground">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">Best {scale.size} here<span className="block text-xs">fouls: most {scale.size}</span></th>
                <td className="px-3 py-1.5 text-right">{r1(scale.auto)}</td>
                <td className="px-3 py-1.5 text-right">{r1(scale.teleop)}</td>
                <td className="px-3 py-1.5 text-right">{r1(scale.endgame)}</td>
                <td className="px-3 py-1.5 text-right">{r1(scale.fouls)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">Engine ratings for the season (auto, TeleOp without the endgame, endgame, penalty points given away), points a match.</p>
      </CollapsibleContent>
    </Collapsible>
  );
}
