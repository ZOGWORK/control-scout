// The two home sections that outlived the classic home: `nextMatch`, which the dashboard and My team
// share, and Control Scout's own opt-in usage (Home, and the owner console's Analytics).
import { Info, RefreshCw } from "lucide-react";
import { useApi } from "../../lib/api";
import { ago } from "../../lib/format";
import type { MatchView } from "../../shared/api";
import type { PublicUsage } from "../../shared/home";
import { Button } from "../ui/button";
import { shortDay, usageView } from "./homeModel";

const fmt = (n: number) => n.toLocaleString();

/** Unplayed and not stale: a match scheduled well in the past belongs to a finished event (a left-over
 *  slot), while same-day delays still count. Without a known time zone, the event-local time read as UTC
 *  is within ±14 h of the real instant, so it still orders the schedule; the stale cutoff gets that much slack. */
export function nextMatch(matches: MatchView[], now = Date.now()): MatchView | undefined {
  const at = (m: MatchView) => m.startsAt ? Date.parse(m.startsAt) : m.time ? Date.parse(`${m.time.replace(/Z$/, "")}Z`) : NaN;
  const slack = (m: MatchView) => (m.startsAt ? 12 : 26) * 3600_000;
  return matches
    .filter((m) => !m.played && (!Number.isFinite(at(m)) || at(m) > now - slack(m)))
    .sort((a, b) => (Number.isFinite(at(a)) ? at(a) : Infinity) - (Number.isFinite(at(b)) ? at(b) : Infinity))[0];
}

// --- Control Scout, in use ------------------------------------------------------------

/** `path`: the owner console reads its own copy (/api/owner/public-usage), there whether or not it's published. */
export function PublicUsagePanel({ path = "/api/public-usage" }: { path?: string } = {}) {
  const state = useApi<PublicUsage>(path);
  const v = state.data ? usageView(state.data) : state.error ? usageView(null) : null;
  const max = v?.kind === "available" ? Math.max(1, ...v.daily.map((d) => d.pageViews)) : 1;
  return (
    <section aria-labelledby="usage-title" className="min-w-0 border-t border-line pt-8 max-sm:pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="usage-title" className="font-display text-2xl font-semibold">Control Scout, in use.</h2>
          <p className="mt-1 text-sm text-text-muted">Opt-in, anonymous counts from visitors who allowed usage statistics. Not all traffic, and not people.</p>
        </div>
        {v?.kind === "unavailable" && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-text-muted"><Info className="size-3.5" aria-hidden /> {v.reason === "not-published" ? "Not published" : "Unavailable"}</span>
        )}
      </div>
      {!v ? <div aria-busy="true" className="mt-4 h-32 rounded-2xl border border-line" /> : v.kind === "unavailable" ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line px-5 max-sm:px-4 py-5 max-sm:py-4 text-sm text-text-muted">
          {v.message}{v.reason === "not-published" && " Page views and sessions started will show here once they are."}
          {(v.reason === "error" || v.reason === "unreachable") && <Button variant="secondary" size="sm" onClick={state.reload}><RefreshCw /> Try again</Button>}
        </div>
      ) : (
        <>
          <dl className="mt-4 grid rounded-2xl border border-line @2xl/home:grid-cols-[1fr_1fr_1.6fr]">
            <div className="px-5 max-sm:px-4 py-4">
              <dt className="text-sm font-medium">Page views</dt>
              <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{fmt(v.totals.pageViews)}</dd>
            </div>
            <div className="border-line px-5 max-sm:px-4 py-4 @max-2xl/home:border-t @2xl/home:border-l">
              <dt className="text-sm font-medium">Sessions started</dt>
              <dd className="mt-1 font-display text-3xl font-semibold tabular-nums">{fmt(v.totals.sessionStarts)}</dd>
            </div>
            <div className="border-line px-5 max-sm:px-4 py-4 @max-2xl/home:border-t @2xl/home:border-l">
              <dt className="text-sm font-medium">Daily page views</dt>
              <dd className="mt-2">
                <svg viewBox={`0 0 ${v.daily.length * 6} 40`} preserveAspectRatio="none" className="h-12 w-full" role="img"
                  aria-label={`Daily page views from ${shortDay(v.from)} to ${shortDay(v.to)}: ${v.daily.map((d) => `${shortDay(d.day)} ${d.pageViews}`).join(", ")}`}>
                  {v.daily.map((d, i) => {
                    const h = d.pageViews ? Math.max(1.5, (d.pageViews / max) * 40) : 0.75;
                    return <rect key={d.day} x={i * 6 + 0.75} y={40 - h} width={4.5} height={h} rx={1} className={i === v.daily.length - 1 ? "fill-accent/50" : "fill-accent"}><title>{`${shortDay(d.day)}: ${fmt(d.pageViews)} page views, ${fmt(d.sessionStarts)} sessions started`}</title></rect>;
                  })}
                </svg>
                <span className="mt-1 flex justify-between text-[11px] tabular-nums text-text-muted"><span>{shortDay(v.from)}</span><span>{shortDay(v.to)} (so far)</span></span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            {shortDay(v.from)} to {shortDay(v.to)}, UTC days; today is still being counted.{v.measuredFrom && ` Counting began ${shortDay(v.measuredFrom)}.`} A session is one browser tab’s visit, not a unique person. Updated {ago(v.generatedAt)}.
          </p>
        </>
      )}
    </section>
  );
}
