// "Know your match" (v1.6 Task 2): /events/:season/:code/match/:key, the pre-match scouting report for
// one match. A page of its own (not a sheet over the event page) so it can be shared in a team chat,
// opened straight from a link, and left with the back button. One tap away from every match row (the
// "Report" link), the opened match's details, and the event page's LIVE panel.
//
// Data: the public report (one request for the whole lineup) and, for workspace members, the workspace
// half (one more): src/lib/matchReport.ts. While the event is live the report refreshes on the event
// page's cadence (lib/liveMode.ts).
import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ChevronLeft, ChevronRight, WifiOff } from "lucide-react";
import { load, useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { useEventPoll } from "../lib/liveMode";
import { matchReportPath, useMatchReportWorkspace, useWatchFlags } from "../lib/matchReport";
import { matchTime, seasonLabel } from "../lib/format";
import { matchReportHref, normalMatchKey, type MatchReport } from "../shared/matchReport";
import { Async } from "../components/states";
import { EmptyState, Page } from "../components/page";
import { Button } from "../components/ui/button";
import { NotFoundView } from "../components/NotFoundView";
import { MatchReportView } from "../components/MatchReport";
import { SnapshotBanner, SnapshotFrame } from "../components/offline/Snapshot";
import { useBundle, useBundleSnapshot, type FoundSnapshot } from "../lib/offline/useBundle";
import { bundleFor } from "../lib/offline/bundleMeta";

export default function MatchReportPage() {
  const { season, code, key: rawKey } = useParams();
  // Read the key as the server's preview does (QUAL:0:01 is qual:0:1), so a link that previews also opens.
  const key = normalMatchKey(rawKey);
  const valid = /^\d+$/.test(season ?? "") && !!code && key != null;
  const path = valid ? matchReportPath(season!, code!, key!) : null;
  const state = useApi<MatchReport>(path);
  const status = valid ? (state.error as ApiError | undefined)?.status : 400;
  const missing = status === 404 || status === 400;
  useTitle(missing ? "Match not found" : state.data ? `${state.data.match.label} · ${state.data.event.name}` : "Know your match");
  useEventPoll(state.data, () => { if (path) load(path, true).catch(() => {}); });
  // No signal (or none in OFFLINE_TIMEOUT_MS): the report frozen in this event's bundle, if it holds one. Live
  // takes over the moment the report loads (the page keeps asking: lib/api.ts).
  const snapshot = useBundleSnapshot(valid ? Number(season) : null, code ?? null, key, state.data ? null : (state.error as ApiError | undefined)?.offline ? "offline" : state.loading ? "waiting" : null);
  // The request failed for want of signal and this event's bundle doesn't hold this match's report (it saves
  // only the chosen team's): the event page has the match, answered from the bundle. Which reports it holds:
  // its saved list, or (bundles saved before that list was kept) the decoded bundle.
  const saved = valid && !state.data && (state.error as ApiError | undefined)?.offline ? bundleFor(Number(season), code!) : null;
  const decoded = useBundle(saved && !saved.reportKeys ? saved.season : null, saved && !saved.reportKeys ? saved.code : null).bundle;
  const held = saved?.reportKeys ?? decoded?.reports.map((r) => r.key) ?? null;
  if (!state.data && snapshot) return <Page><SnapshotReport snap={snapshot} /></Page>;
  if (saved && held && !held.includes(key!)) {
    return (
      <Page>
        <EmptyState icon={WifiOff} title="This match's report isn't saved on this device"
          description="There's no signal, and your event-day bundle holds reports only for your team's matches. The event page has this match from the bundle."
          action={<Button asChild><Link to={`/events/${saved.season}/${encodeURIComponent(saved.code)}?tab=matches&match=${encodeURIComponent(key!)}`}>Open the match on the event page</Link></Button>} />
      </Page>
    );
  }
  if (missing) {
    return <NotFoundView title={`No match ${rawKey ?? ""} at ${code ?? ""}`} description="The match may not be scheduled yet, or the link is from another event. Open the event to see its schedule." />;
  }
  return (
    <Page>
      <Async state={state} loading={<div className="space-y-4"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-40 rounded-xl" /><div className="skeleton h-80 rounded-xl" /></div>}>
        {(r) => <Report r={r} />}
      </Async>
    </Page>
  );
}

function Report({ r }: { r: MatchReport }) {
  const m = r.match;
  const teams = useMemo(() => r.teams.map((t) => t.team), [r.teams]);
  const ws = useMatchReportWorkspace(m.season, m.code, teams);
  const watch = useWatchFlags(teams, ws?.state.data);
  const back = `/events/${m.season}/${encodeURIComponent(m.code)}?tab=matches&match=${encodeURIComponent(m.key)}`;
  const step = (x: { key: string; label: string } | null, dir: "prev" | "next") => x && (
    <Link to={matchReportHref({ season: m.season, code: m.code, key: x.key })} className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-2 text-sm hover:border-accent/50"
      aria-label={`${dir === "prev" ? "Previous" : "Next"} match, ${x.label}`}>
      {dir === "prev" && <ChevronLeft className="size-4" aria-hidden />}{x.label}{dir === "next" && <ChevronRight className="size-4" aria-hidden />}
    </Link>
  );
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to={back} className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /><span className="truncate">{r.event.name}</span>
        </Link>
        <span className="ml-auto flex gap-1.5">{step(r.prev, "prev")}{step(r.next, "next")}</span>
      </div>
      <header className="mb-5 max-sm:mb-4">
        <p className="text-xs text-muted-foreground">Know your match · {seasonLabel(m.season)}</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {r.description ?? m.label}
          {m.time && <span className="ml-3 align-middle text-sm font-normal text-muted-foreground">{matchTime(m.time)}</span>}
        </h1>
      </header>
      <MatchReportView r={r} ws={ws} watch={watch} />
    </div>
  );
}

/** The frozen report from the event-day bundle, under its banner (time and age). */
function SnapshotReport({ snap }: { snap: FoundSnapshot }) {
  const { meta, report } = snap;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link to={`/bundle/${meta.season}/${encodeURIComponent(meta.code)}`} className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /><span className="truncate">{meta.name} bundle</span>
        </Link>
      </div>
      <SnapshotBanner at={meta.dataAsOf ?? meta.builtAt}>The live report replaces this as soon as it loads.</SnapshotBanner>
      <SnapshotFrame html={report.html} title={`${report.label}, snapshot`} />
    </div>
  );
}
