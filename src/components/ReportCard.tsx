// Predictability report card (team page): how the engine's live calls on a
// team's matches turned out. Stored rows only (server/stats/reportCards.ts);
// live calls only, never the backtest replay. Small samples are shown pulled
// toward the field average, with the sample size and the raw numbers beside.
import { Link } from "react-router-dom";
import { Activity, Crosshair, Waves } from "lucide-react";
import type { ReportCard, TeamReportCards } from "../shared/api";
import { Section } from "./page";
import { StatTile } from "./StatTile";
import { num, pct } from "../lib/format";
import { cn } from "./cn";

const signed = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}`);
const calls = (n: number) => `${n} live call${n === 1 ? "" : "s"}`;

/** Below this many calls the card says plainly that it leans on the field average. */
export const SMALL_SAMPLE = 10;

export function ReportCardSection({ team, season, data }: { team: number; season: number; data: TeamReportCards | null | undefined }) {
  const s = data?.season;
  return (
    <Section title="Prediction report card"
      description={<>How the engine's pre-match calls on {team}'s matches turned out this season. Live calls only, each logged before its match. <Link to="/methodology#report-cards" className="underline">How it's computed</Link></>}>
      {!s || !data ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground max-sm:py-4">
          No scored live calls on {team}'s matches this season yet. The card fills in once matches the engine called beforehand have results.
        </p>
      ) : <Card s={s} data={data} season={season} />}
    </Section>
  );
}

function Card({ s, data, season }: { s: ReportCard; data: TeamReportCards; season: number }) {
  const f = data.field;
  const small = s.calls < SMALL_SAMPLE;
  const over = s.shrunk.errMean;
  return (
    <div data-testid="report-card">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile tone="accent" icon={Crosshair} label="Called right" value={pct(s.shrunk.hitRate)}
          hint={<>{s.hits} of {s.decided} decided call{s.decided === 1 ? "" : "s"}{f?.hitRate != null && <> · field {pct(f.hitRate)}</>}</>} />
        <StatTile tone="sky" icon={Activity} label="Points vs prediction" value={<>{signed(over)} <span className="text-base font-medium text-muted-foreground">per robot</span></>}
          hint={s.scored ? (over == null || Math.abs(over) < 0.5 ? "About what the engine expected" : over > 0 ? "Scored more than the engine expected" : "Scored less than the engine expected") : "No call had a predicted score yet"} />
        <StatTile tone="violet" icon={Waves} label="Swing" value={<>±{num(s.shrunk.errSd)} <span className="text-base font-medium text-muted-foreground">pts</span></>}
          hint={s.scored ? <>Typical miss {num(s.shrunk.errAbs)} pts per robot{f?.errSd != null && <> · field ±{num(f.errSd)}</>}</> : "No call had a predicted score yet"} />
      </div>
      <p className={cn("mt-3 rounded-xl border p-3 text-xs text-muted-foreground", small ? "border-warning/40 bg-warning/[0.06]" : "border-border bg-card")}>
        Estimate from {calls(s.calls)}{s.scored < s.calls ? ` (${s.scored} with a predicted score)` : ""}.{" "}
        {small ? "A small sample: the numbers are pulled toward the field average, so they say little about this team yet. " : `Pulled toward the field average as if it were ${data.prior} more calls, which matters less as calls add up. `}
        Raw: {pct(s.raw.hitRate)} called right, {signed(s.raw.errMean)} vs prediction, ±{num(s.raw.errSd)} swing. Misses are per robot: the alliance's miss split evenly between its robots.
      </p>
      {data.events.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Report card by finished event</caption>
            <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-text-muted">
              <th className="h-10 px-3">Event</th><th className="px-3 text-right">Calls</th><th className="px-3 text-right">Called right</th><th className="px-3 text-right">Vs prediction</th><th className="px-3 text-right">Swing</th>
            </tr></thead>
            <tbody>
              {[...data.events].reverse().map((e) => (
                <tr key={e.code} className="border-t border-border">
                  <td className="px-3 py-2"><Link to={`/events/${season}/${e.code}`} className="hover:underline">{e.name ?? e.code}</Link></td>
                  <td className="px-3 text-right tabular-nums">{e.calls}</td>
                  <td className="px-3 text-right tabular-nums">{pct(e.shrunk.hitRate)} <span className="text-xs text-muted-foreground">({e.hits}/{e.decided})</span></td>
                  <td className="px-3 text-right tabular-nums">{signed(e.shrunk.errMean)}</td>
                  <td className="px-3 text-right tabular-nums">±{num(e.shrunk.errSd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
