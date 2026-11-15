// This weekend (docs/weekend.md): the weekend's FTC events in one place, and a team's next match. Linked from Home's
// "On the calendar". The weekend is search's own ("this weekend", "next weekend", "last weekend": src/shared/query/time.ts),
// each event placed on its own calendar; a place as Rankings picks it, "My region" when My team is set; the current
// season only. Everything comes from GET /api/weekend and GET /api/teams/:number/next (server/api/weekend.ts), the
// readings search answers from, so the page and search never list different events or a different match.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, PlayCircle, Radio, Search, Star } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { PageHeader } from "../components/page";
import { ErrorState } from "../components/states";
import { Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import { NextMatchPanel } from "../components/NextMatchPanel";
import { PlacePicker, active, idle, placeName, trigger } from "./RankingsPage";
import type { RankingPlaces } from "../shared/rankings";
import { eventKindLabel, noEventsLine, type NextMatchAnswer, type WeekendAnswer, type WeekendEvent, viewerToday } from "../shared/weekend";
import type { Weekend } from "../shared/query/time";

const WHICH: { id: Weekend; label: string }[] = [{ id: "last", label: "Last weekend" }, { id: "this", label: "This weekend" }, { id: "next", label: "Next weekend" }];

export default function WeekendPage() {
  const [sp, setSp] = useSearchParams();
  const raw = sp.get("which");
  const which: Weekend = raw === "next" || raw === "last" ? raw : "this";
  const region = sp.get("region") || null;
  const { state: personal } = usePersonal();
  const myTeam = personal.myTeam;
  const [today] = useState(() => viewerToday());
  const res = useApi<WeekendAnswer>(`/api/weekend${qs({ which: which === "this" ? null : which, region, today })}`);
  const places = useApi<RankingPlaces>(res.data ? `/api/rankings/places${qs({ season: res.data.season, team: myTeam })}` : null);
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") q.delete(k); else q.set(k, v); }
    setSp(q, { replace: true });
  };
  const d = res.data;
  const label = WHICH.find((w) => w.id === which)!.label;
  useTitle(`FTC events ${label.toLowerCase()}${region ? ` in ${placeName(region)}` : ""}`);
  const mine = places.data?.mine ?? null;
  const mineOn = !!mine && region === mine;

  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">{d ? `${d.seasonLabel} season · ${d.window.label}` : label}</span>}
        title={`${label}${region ? ` in ${placeName(region)}` : ""}`}
        description="Every FTC event this weekend, live ones first to open, and your team's next match. Dates are each event's own."
        phoneDescription="This weekend's FTC events and your next match."
      >
        <div className="flex flex-wrap items-center gap-2" data-weekend-filters>
          <div role="tablist" aria-label="Which weekend" className="inline-flex rounded-lg border border-line p-0.5">
            {WHICH.map((w) => (
              <button key={w.id} type="button" role="tab" aria-selected={which === w.id} onClick={() => go({ which: w.id === "this" ? null : w.id })}
                className={cn("h-8 rounded-md px-3 text-sm font-medium max-sm:h-10 max-sm:px-2.5", which === w.id ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text-base")}>{w.label}</button>
            ))}
          </div>
          <PlacePicker info={places.data} loading={places.loading} value={region ? [region] : []} onChange={(keys) => go({ region: keys.at(-1) ?? null })} />
          {mine && (
            <button type="button" onClick={() => go({ region: mineOn ? null : mine })} aria-pressed={mineOn} className={cn(trigger, mineOn ? active : idle)} title={`Events in ${placeName(mine)}, where team ${myTeam} is from`}>
              <Star className="size-4 text-accent" />My region<span className="text-text-muted max-sm:hidden">· {placeName(mine)}</span>
            </button>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="weekend-events" className="min-w-0">
          <h2 id="weekend-events" className="sr-only">Events</h2>
          {res.error && !d ? <ErrorState error={res.error} onRetry={res.reload} /> : !d ? (
            <ul aria-busy="true" className="divide-y divide-line border-y border-line">{[0, 1, 2, 3].map((i) => <li key={i} className="h-[4.5rem]" />)}</ul>
          ) : !d.events.length ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-sm" data-no-events>
              {noEventsLine(which, d.region)} <span className="text-text-muted">({d.window.label}, {d.seasonLabel} season.)</span> <Link to="/events" className="font-medium text-accent-text underline">Browse the season calendar</Link>.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-text-muted" data-weekend-count>{d.events.length} event{d.events.length === 1 ? "" : "s"}{d.events.some((e) => e.status === "live") ? ` · ${d.events.filter((e) => e.status === "live").length} live now` : ""}<span className="sm:hidden"> · {d.window.label} · {d.seasonLabel} season</span></p>
              <ul className="divide-y divide-line border-y border-line" data-weekend-list>{d.events.map((e) => <EventRow key={e.code} e={e} />)}</ul>
            </>
          )}
        </section>
        <aside aria-label="Next match" className="space-y-4">
          {myTeam ? <TeamNext team={myTeam} /> : <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm text-text-muted">Pick My team on its team page to see its next match here.</p>}
          <AnyTeam mine={myTeam} />
        </aside>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: WeekendEvent }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3" data-weekend-event={e.code}>
      <Link to={e.href} className="min-w-0 flex-1 basis-[16rem] hover:underline">
        <span className="block font-medium">{e.name}</span>
        <span className="block text-sm text-text-muted">{[eventKindLabel(e.type), e.place, e.dates, e.teams ? `${e.teams} team${e.teams === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</span>
      </Link>
      <span className="flex shrink-0 items-center gap-2">
        {e.status === "live" && <Link to={e.href} className="inline-flex h-8 items-center gap-1 rounded-full bg-danger/10 px-2.5 text-xs font-semibold text-danger max-sm:h-10"><Radio className="size-3.5" aria-hidden /> Live now</Link>}
        {e.recording && <a href={e.recording} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium max-sm:h-10"><PlayCircle className="size-3.5" aria-hidden /> Recording</a>}
        {e.status === "finished" && !e.recording && <span className="text-xs text-text-muted">Finished</span>}
        {e.status === "upcoming" && <span className="inline-flex items-center gap-1 text-xs text-text-muted"><CalendarDays className="size-3.5" aria-hidden /> Upcoming</span>}
      </span>
    </li>
  );
}

function TeamNext({ team }: { team: number }) {
  const r = useApi<NextMatchAnswer>(`/api/teams/${team}/next`);
  if (r.error && !r.data) return <ErrorState error={r.error} onRetry={r.reload} />;
  if (!r.data) return <div className="h-24 rounded-xl border border-line" aria-busy="true" />;
  return <NextMatchPanel a={r.data} />;
}

/** Any team's next match: a number typed. */
function AnyTeam({ mine }: { mine: number | null }) {
  const [typed, setTyped] = useState("");
  const [team, setTeam] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); const n = Number(typed.trim()); setTeam(Number.isInteger(n) && n > 0 && n < 1_000_000 ? n : null); }}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} inputMode="numeric" placeholder={mine ? "Another team's number" : "Team number"} aria-label="Team number" className="h-9 max-sm:h-10" />
        <Button type="submit" variant="secondary" size="sm" className="max-sm:h-10"><Search /> Next match</Button>
      </form>
      {team != null && team !== mine && <TeamNext team={team} />}
    </div>
  );
}
