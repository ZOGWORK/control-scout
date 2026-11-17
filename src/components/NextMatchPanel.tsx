// A team's next match this weekend (server/api/weekend.ts teamNextMatch, GET /api/teams/:number/next): the event, the
// match, its time on the event's clock (and the viewer's, where it differs), the alliance, partners, opponents and the
// call; else what the team has this weekend, or its next event. The "This weekend" page shows it for My team and any
// team typed; search answers "4215 next match" from the same reading.
import { Link } from "react-router-dom";
import { CalendarDays, PlayCircle } from "lucide-react";
import type { NextMatchAnswer, NextMatchTeam } from "../shared/weekend";
import { eventClock } from "../shared/weekend";
import { oddsPct } from "../lib/format";
import { TierMark } from "./predict";
import { cn } from "./cn";

type Match = NonNullable<NextMatchAnswer["match"]>;

/** The viewer's own clock for the match, when its zone isn't the event's ("Sat 7:30 AM PST"); null when the same. */
function yourClock(m: Match): string | null {
  if (!m.startsAt || !m.timezone) return null;
  const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!mine || mine === m.timezone) return null;
  const a = eventClock(m.startsAt, m.timezone), b = eventClock(m.startsAt, mine);
  return a === b ? null : b;
}

const teamsText = (ts: NextMatchTeam[]) => ts.map((t) => t.number).join(" + ") || "—";

function MatchBox({ m, team, lead }: { m: Match; team: number; lead: boolean }) {
  const yours = yourClock(m);
  return (
    <Link to={m.href} data-next-match={lead ? "" : undefined}
      className={cn("lift block rounded-xl border p-3 text-sm pointer-coarse:min-h-[44px]", lead ? "border-accent/30 bg-accent/[0.05]" : "border-line bg-card")}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0"><span className="font-semibold">{lead ? "Next match" : "Played"} · {m.label}</span> <span className="text-text-muted">{m.event}</span></span>
        {m.prediction && <span className="flex shrink-0 flex-col items-end tabular-nums font-medium text-accent-text">{oddsPct(m.prediction.chance)} to win<TierMark tier={m.prediction.tier} className="text-xs font-normal" /></span>}
        {m.score && <span className="shrink-0 tabular-nums font-semibold">{m.score.result === "W" ? "Won" : m.score.result === "L" ? "Lost" : "Tied"} {m.score.own}–{m.score.opp}</span>}
      </span>
      {!m.played && <span className="mt-1 block text-text-muted"><CalendarDays className="mr-1 inline size-3.5" aria-hidden />{eventClock(m.startsAt, m.timezone) || "Time not posted yet"}{yours ? ` · ${yours} your time` : ""}</span>}
      <span className="mt-1 block text-text-muted">
        <span className={m.alliance === "red" ? "text-red-alliance" : "text-blue-alliance"}>{m.alliance === "red" ? "Red" : "Blue"}</span>: {team}{m.partners.length ? ` + ${teamsText(m.partners)}` : ""} vs {teamsText(m.opponents)}
        {m.prediction && <> · expected {Math.round(m.prediction.ownMean)}–{Math.round(m.prediction.oppMean)}</>}
      </span>
      {m.video && <span className="mt-1 inline-flex items-center gap-1 text-accent-text"><PlayCircle className="size-3.5" aria-hidden /> Video</span>}
    </Link>
  );
}

export function NextMatchPanel({ a }: { a: NextMatchAnswer }) {
  const who = a.name ? `${a.team} ${a.name}` : `Team ${a.team}`;
  return (
    <div className="space-y-2" data-next-match-panel>
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-text-muted"><Link to={`/teams/${a.team}`} className="hover:underline">{who}</Link></p>
      {a.kind === "match" && a.match ? <MatchBox m={a.match} team={a.team} lead /> : (
        <p className="rounded-xl border border-dashed border-line px-3 py-3 text-sm" data-no-match>
          {a.line}{a.event && <> <Link to={a.event.href} className="font-medium text-accent-text underline" aria-label={`Open ${a.event.name}`}>Open the event →</Link></>}
        </p>
      )}
      {a.played.map((m) => <MatchBox key={`${m.code}|${m.key}`} m={m} team={a.team} lead={false} />)}
    </div>
  );
}
