// Simulated rankings (Rankings tab, before qualification matches start): only on a click, the server runs the
// engine's event simulation a couple of thousand times (server/projections/rankingSim.ts) and this shows each
// team's odds of finishing first, top 4 and top 8, with its average rank and 80% range. Loud about how rough it
// is: nobody has played yet, ratings come from earlier events, and with no schedule out the schedule is random.
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Dices } from "lucide-react";
import { SimProgress } from "./SimProgress";
import { useApi } from "../lib/api";
import type { EventDetail } from "../shared/api";
import { DEFAULT_PER_TEAM, PER_TEAM_CHOICES, type SimRankResult } from "../shared/rankingSimView";
import { Button } from "./ui/button";
import { cn } from "./cn";

type Answer = ({ status: "ok" } & SimRankResult) | { status: "unavailable"; reason: string };

/** A short stable hash (FNV-1a, base 36) of what the simulation reads. */
const fingerprint = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0; return h.toString(36); };

const pct = (p: number) => (p >= 0.995 ? ">99%" : p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`);

/** A share as a cell: gold, stronger the likelier. */
function Odds({ p }: { p: number }) {
  return (
    <span className="inline-block min-w-[3.25rem] rounded-md px-1.5 py-0.5 text-center tabular-nums max-sm:min-w-[2.6rem] max-sm:px-1 max-sm:text-xs"
      style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round(Math.min(1, p) * 55)}%, transparent)` }}>
      {pct(p)}
    </span>
  );
}

export function SimulatedRankings({ d, team }: { d: EventDetail; team: number | null }) {
  const [on, setOn] = useState(false);
  const [perTeam, setPerTeam] = useState(DEFAULT_PER_TEAM);
  const scheduled = d.matches.some((m) => m.level === "qual");
  // What the simulation reads from the page: the teams and the schedule. A change (a corrected schedule, a team
  // added) is a new address, so an open table asks again; the server keys its own copy on the data version.
  const v = fingerprint(`${d.field.map((t) => t.team).join(",")}|${d.matches.filter((m) => m.level === "qual").map((m) => `${m.key}:${m.red.teams.map((t) => t.number)}v${m.blue.teams.map((t) => t.number)}`).join(";")}`);
  const path = `/api/events/${d.event.season}/${encodeURIComponent(d.event.code)}/simulated-rankings?${scheduled ? "" : `perTeam=${perTeam}&`}v=${v}`;
  const { data, error, loading, reload } = useApi<Answer>(on ? path : null);
  const names = new Map(d.field.map((t) => [t.team, t.name]));

  if (!on) return (
    <section aria-labelledby="sim-rank-h" className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 max-sm:mb-4" data-sim-rankings>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"><Dices className="size-5" aria-hidden /></span>
      <div className="min-w-0 flex-1">
        <h2 id="sim-rank-h" className="font-display text-base font-semibold text-foreground">Simulated rankings</h2>
        <p className="text-sm text-muted-foreground">How the model thinks qualification could end, before a match is played. A rough guess: open it knowing that.</p>
      </div>
      <Button variant="outline" size="sm" onClick={() => setOn(true)} className="max-sm:h-10 max-sm:w-full"><Dices /> Simulate the rankings</Button>
    </section>
  );

  const ok = data?.status === "ok" ? data : null;
  return (
    <section aria-labelledby="sim-rank-h" className="mb-6 rounded-2xl border border-border bg-card p-4 max-sm:mb-4 max-sm:p-3" data-sim-rankings>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="sim-rank-h" className="flex items-center gap-2 font-display text-base font-semibold text-foreground"><Dices className="size-5 text-accent-text" aria-hidden /> Simulated rankings</h2>
        {!scheduled && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground max-sm:ml-0 max-sm:w-full">
            <span id="sim-rank-pt">Matches per team</span>
            <div role="radiogroup" aria-labelledby="sim-rank-pt" className="flex flex-wrap gap-1">
              {PER_TEAM_CHOICES.map((n) => (
                <button key={n} type="button" role="radio" aria-checked={perTeam === n} onClick={() => setPerTeam(n)}
                  className={cn("h-8 min-w-8 rounded-md border px-2 text-xs font-semibold tabular-nums max-sm:h-9 max-sm:min-w-9",
                    perTeam === n ? "border-accent bg-accent text-accent-ink" : "border-line bg-background text-muted-foreground hover:text-foreground")}>{n}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-foreground" role="note" data-sim-warning>
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <b>Highly uncertain.</b> No match here has been played yet. Each team's strength comes from its matches so far
          this season; a team with none yet (marked est.) is estimated from earlier seasons, or counts as a typical new team.{" "}
          {scheduled ? "The published schedule is used, " : `The schedule isn't out, so every simulation draws a random one (${perTeam} matches each), `}
          but real rankings swing on partners, opponents and a handful of matches. Read these as odds, never as places.
        </span>
      </p>
      {loading && !ok && <SimProgress runs={2000} label="Simulating the rankings" />}
      {error && (
        <div className="flex flex-wrap items-center gap-3 py-4">
          <p className="text-sm text-destructive">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void reload()} className="max-sm:h-10">Try again</Button>
        </div>
      )}
      {data?.status === "unavailable" && <p className="py-4 text-sm text-muted-foreground">{data.reason}</p>}
      {ok && (
        <>
          <div className={cn("overflow-x-auto", loading && "opacity-60")}>
            <table className="w-full text-sm max-sm:text-[13px]">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-2 font-semibold max-sm:hidden">Proj.</th>
                  <th className="py-2 pr-2 font-semibold">Team</th>
                  <th className="py-2 pr-2 text-right font-semibold max-sm:pr-1">Avg<span className="max-sm:hidden"> rank</span></th>
                  <th className="py-2 pr-2 text-center font-semibold max-sm:pr-1">#1</th>
                  <th className="py-2 pr-2 text-center font-semibold max-sm:pr-1">Top 4</th>
                  <th className="py-2 text-center font-semibold">Top 8</th>
                </tr>
              </thead>
              <tbody>
                {ok.teams.map((t, i) => (
                  <tr key={t.team} className={cn("border-t border-border", team === t.team && "bg-accent/[0.08]")} data-team={t.team}>
                    <td className="py-2 pr-2 tabular-nums text-muted-foreground max-sm:hidden">{i + 1}</td>
                    <td className="py-2 pr-2 max-sm:w-full max-sm:max-w-0">
                      <Link to={`/teams/${t.team}`} className="hover:text-accent-text max-sm:block max-sm:truncate"><span className="font-mono font-semibold">{t.team}</span> <span className="text-foreground/85">{names.get(t.team) ?? ""}</span></Link>
                      {!t.played && <span className="text-[11px] text-muted-foreground sm:ml-1.5 max-sm:block" title="No matches this season yet: estimated from earlier seasons, or a typical new team">est., no matches yet</span>}
                    </td>
                    <td className="py-2 pr-2 text-right tabular-nums max-sm:pr-1">
                      {Number.isFinite(t.mean) ? t.mean.toFixed(1) : "—"}
                      <span className="block whitespace-nowrap text-[11px] text-muted-foreground" title="80% of simulations land in this range">{t.p10}–{t.p90}</span>
                    </td>
                    <td className="py-2 pr-2 text-center max-sm:pr-1"><Odds p={t.first} /></td>
                    <td className="py-2 pr-2 text-center max-sm:pr-1"><Odds p={t.top4} /></td>
                    <td className="py-2 text-center"><Odds p={t.top8} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {ok.runs.toLocaleString()} simulated events with the model's own ranking points and tiebreakers.
            The range under each average rank holds 80% of them. Gone once qualification starts: the official ranking takes over.
          </p>
        </>
      )}
    </section>
  );
}
