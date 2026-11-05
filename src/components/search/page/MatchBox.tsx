// One match in a search answer, as a box (every list of matches search shows: a season's top scores, a team's best
// and latest matches, two teams' meetings): its place in the list as a podium badge, the match and its event, then a
// scoreboard, the red alliance over the blue, each with its teams as chips and its score big in its colour (the loser
// muted, the winner marked), and the listed alliance's points by phase as small neutral tiles (the search results
// guide: red and blue mark alliances, no other hue). Drawn from the row the server sends; nothing is fetched or worked out beyond adding the numbers up.
import { Link } from "react-router-dom";
import type { StatLink, StatMatchRow } from "../../../shared/searchStat";
import { PODIUM_CHIP } from "../../../lib/textTones";
import { cn } from "../../cn";
import { EventMarker, PODIUM } from "./answerCells";
import { TAP } from "./TeamAnswer";
import { RowPlay } from "./AnswerVideo";

type Who = { number: number; name: string | null };

/** A list position: the top three in a bordered chip, the rest a plain number; no hue. */
export function RankBadge({ rank }: { rank: number }) {
  const tone = PODIUM[rank];
  return <span className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums", tone ? PODIUM_CHIP[rank] : "bg-text-base/[0.07] text-muted-foreground")} data-rank-badge={rank}>{rank}</span>;
}

/** A team as a chip in its alliance's colour: the number bold, the name muted (cut on narrow boxes). */
export function TeamChip({ t, side, self }: { t: StatLink; side: "red" | "blue"; self?: boolean }) {
  const [num, ...rest] = t.label.split(" ");
  return (
    <Link to={t.href} title={t.label} className={cn("inline-flex min-h-7 min-w-0 max-w-full items-center gap-1 rounded-md border px-1.5 text-xs hover:underline", TAP,
      side === "red" ? "border-red-alliance/30 bg-red-alliance/10" : "border-blue-alliance/30 bg-blue-alliance/10", self && "ring-1 ring-foreground/40")} data-team-chip={num}>
      <b className={cn("font-semibold tabular-nums", side === "red" ? "text-red-alliance-ink" : "text-blue-alliance-text")}>{num}</b>
      {rest.length > 0 && <span className="truncate text-muted-foreground">{rest.join(" ")}</span>}
    </Link>
  );
}

const PHASES: ["auto" | "teleop" | "endgame" | "pen", string][] = [["auto", "Auto"], ["teleop", "TeleOp"], ["endgame", "Endgame"], ["pen", "Pen given"]];

export function MatchBox({ r, team }: { r: StatMatchRow; team?: Who }) {
  const other = r.alliance === "red" ? "blue" : "red";
  // A team's own row lists its partners without it: the team goes first on its own alliance (the row's own team, else
  // the card's). The card's team is named in the card's header, so its chip is the number alone (each name once).
  const own = r.self ?? (team ? { label: String(team.number), href: `/teams/${team.number}` } : null);
  const path = (t: StatLink) => t.href.split("?")[0];
  const self: StatLink[] = own && !(r.partners ?? []).some((p) => path(p) === path(own)) ? [own] : [];
  const short = (t: StatLink) => (team && path(t) === `/teams/${team.number}` ? { ...t, label: String(team.number) } : t);
  const sides = { [r.alliance]: [...self, ...(r.partners ?? [])].map(short), [other]: (r.opponents ?? []).map(short) } as Record<"red" | "blue", StatLink[]>;
  // The listed score without penalties where the row ranks by it (the other side's then too), else the official ones.
  const np = r.ownNp != null;
  const score = { [r.alliance]: { shown: np ? r.ownNp! : r.own, total: r.own }, [other]: { shown: np && r.oppNp != null ? r.oppNp : r.opp, total: r.opp } } as Record<"red" | "blue", { shown: number; total: number }>;
  const winner = r.result === "T" ? null : r.result === "W" ? r.alliance : other;
  const phases = r.phases && PHASES.filter(([k]) => r.phases![k] != null);
  return (
    <li className="flex h-full min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3" data-match-box={r.label}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {r.rank != null && <RankBadge rank={r.rank} />}
        {r.note && <span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px] font-semibold text-foreground" data-note>{r.note}</span>}
        <Link to={r.href} className={cn("inline-flex items-center font-display text-base font-semibold text-foreground hover:text-accent-text hover:underline", TAP)}>{r.label}</Link>
        <span className="min-w-0 flex-1 basis-40 text-xs text-muted-foreground">
          <Link to={r.event.href} className="break-words font-medium text-foreground/90 hover:text-accent-text hover:underline">{r.event.label}</Link>
          {!!r.type && <EventMarker type={r.type} chip />}
          {` · ${r.season}`}{r.date ? ` · ${r.date}` : ""}
        </span>
        <RowPlay href={r.href} label={`${r.label} · ${r.event.label}`} className="-my-1 -mr-1 ml-auto" />
      </div>
      <div className="grid min-w-0 flex-1 gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1.5" data-scoreboard>
          {(["red", "blue"] as const).map((s) => {
            const won = winner === s, lost = winner != null && !won;
            const sc = score[s];
            return (
              <div key={s} className={cn("flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5", s === "red" ? "bg-red-alliance/[0.08]" : "bg-blue-alliance/[0.08]")} data-alliance={s} data-won={won ? "" : undefined}>
                <span className="sr-only">{s === "red" ? "Red" : "Blue"} alliance{won ? ", won" : lost ? ", lost" : ""}: </span>
                <span className="flex min-w-0 flex-1 flex-wrap gap-1">
                  {sides[s].length ? sides[s].map((t) => <TeamChip key={t.href} t={t} side={s} self={!!self.length && path(t) === path(self[0])} />) : <span className="text-xs text-muted-foreground">Teams not listed</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="flex items-center justify-end gap-1.5">
                    {won && <span className="rounded bg-foreground px-1 text-[10px] font-bold text-background" aria-hidden>W</span>}
                    <b className={cn("font-display text-2xl font-semibold leading-none tabular-nums", lost ? "text-muted-foreground" : s === "red" ? "text-red-alliance-ink" : "text-blue-alliance-text")}>{sc.shown}</b>
                  </span>
                  {sc.total !== sc.shown && <span className="block text-[11px] text-muted-foreground">{sc.total} with penalties</span>}
                </span>
              </div>
            );
          })}
        </div>
        {!!phases?.length && (
          <dl className="grid grid-cols-4 gap-1 self-center sm:w-44 sm:grid-cols-2" aria-label={`${r.alliance === "red" ? "Red" : "Blue"} alliance's points by phase`} data-phases>
            {phases.map(([k, label]) => (
              // The period a list ranks by: a stronger border and bold label (no hue).
              <div key={k} className={cn("rounded-md border bg-muted/30 px-1.5 py-1", r.ranked === k ? "border-foreground/60" : "border-border")} data-phase={k} data-ranked={r.ranked === k ? "" : undefined}>
                {/* TeleOp as FIRST reports it: with the endgame where the season counts it so. */}
                <dt className={cn("truncate text-[10px] leading-tight", r.ranked === k ? "font-semibold text-foreground" : "text-muted-foreground")}>{k === "teleop" && r.phases!.teleopWithEndgame ? "TeleOp + end" : label}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{r.phases![k]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}
