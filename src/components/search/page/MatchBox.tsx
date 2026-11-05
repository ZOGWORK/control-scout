// One match in a search answer, as a box (every list of matches search shows: a season's top scores, a team's best
// and latest matches, two teams' meetings): its place in the list as a podium badge, the match and its event, then a
// scoreboard, the red alliance over the blue, each with its teams as chips and its score big in its colour (the loser
// muted, the winner marked), and the listed alliance's points by phase as small tiles in the team page's phase
// colours. Drawn from the row the server sends; nothing is fetched or worked out beyond adding the numbers up.
import { Link } from "react-router-dom";
import type { StatLink, StatMatchRow } from "../../../shared/searchStat";
import { PODIUM_CHIP } from "../../../lib/textTones";
import { TONES, type Tone } from "../../StatTile";
import { cn } from "../../cn";
import { EventMarker, PODIUM } from "./answerCells";
import { TAP } from "./TeamAnswer";

type Who = { number: number; name: string | null };

/** A list position: the top three in the search podium's colours, the rest a plain number. */
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
      <b className={cn("font-semibold tabular-nums", side === "red" ? "text-red-alliance-text" : "text-blue-alliance-text")}>{num}</b>
      {rest.length > 0 && <span className="truncate text-muted-foreground">{rest.join(" ")}</span>}
    </Link>
  );
}

const PHASES: [keyof NonNullable<StatMatchRow["phases"]>, string, Tone][] = [["auto", "Auto", "sky"], ["teleop", "TeleOp", "emerald"], ["endgame", "Endgame", "violet"], ["pen", "Pen given", "rose"]];

export function MatchBox({ r, team }: { r: StatMatchRow; team?: Who }) {
  const other = r.alliance === "red" ? "blue" : "red";
  // A team's own row lists its partners without it: the team goes first on its own alliance (the row's own team, else
  // the card's; its name from the card when the row has only the number).
  const own = r.self ?? (team ? { label: String(team.number), href: `/teams/${team.number}` } : null);
  const named = own && team && own.label === String(team.number) && team.name ? { ...own, label: `${team.number} ${team.name}` } : own;
  const self: StatLink[] = named && !(r.partners ?? []).some((p) => p.href.split("?")[0] === named.href.split("?")[0]) ? [named] : [];
  const sides = { [r.alliance]: [...self, ...(r.partners ?? [])], [other]: r.opponents ?? [] } as Record<"red" | "blue", StatLink[]>;
  // The listed score without penalties where the row ranks by it (the other side's then too), else the official ones.
  const np = r.ownNp != null;
  const score = { [r.alliance]: { shown: np ? r.ownNp! : r.own, total: r.own }, [other]: { shown: np && r.oppNp != null ? r.oppNp : r.opp, total: r.opp } } as Record<"red" | "blue", { shown: number; total: number }>;
  const winner = r.result === "T" ? null : r.result === "W" ? r.alliance : other;
  const phases = r.phases && PHASES.filter(([k]) => r.phases![k] != null);
  return (
    <li className="flex h-full min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3" data-match-box={r.label}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {r.rank != null && <RankBadge rank={r.rank} />}
        <Link to={r.href} className={cn("inline-flex items-center font-display text-base font-semibold text-foreground hover:text-accent-text hover:underline", TAP)}>{r.label}</Link>
        <span className="min-w-0 flex-1 basis-40 text-xs text-muted-foreground">
          <EventMarker type={r.type} />
          <Link to={r.event.href} className="break-words font-medium text-foreground/90 hover:text-accent-text hover:underline">{r.event.label}</Link>
          {!!r.type && <EventMarker type={r.type} chip />}
          {` · ${r.season}`}{r.date ? ` · ${r.date}` : ""}
        </span>
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
                  {sides[s].length ? sides[s].map((t) => <TeamChip key={t.href} t={t} side={s} self={t === self[0]} />) : <span className="text-xs text-muted-foreground">Teams not listed</span>}
                </span>
                <span className="shrink-0 text-right">
                  <span className="flex items-center justify-end gap-1.5">
                    {won && <span className="rounded bg-success/15 px-1 text-[10px] font-bold text-success-text" aria-hidden>W</span>}
                    <b className={cn("font-display text-2xl font-semibold leading-none tabular-nums", lost ? "text-muted-foreground" : s === "red" ? "text-red-alliance-text" : "text-blue-alliance-text")}>{sc.shown}</b>
                  </span>
                  {sc.total !== sc.shown && <span className="block text-[11px] text-muted-foreground">{sc.total} with penalties</span>}
                </span>
              </div>
            );
          })}
        </div>
        {!!phases?.length && (
          <dl className="grid grid-cols-4 gap-1 self-center sm:w-44 sm:grid-cols-2" aria-label={`${r.alliance === "red" ? "Red" : "Blue"} alliance's points by phase`} data-phases>
            {phases.map(([k, label, tone]) => (
              <div key={k} className={cn("rounded-md border px-1.5 py-1", TONES[tone].box)}>
                <dt className="truncate text-[10px] leading-tight text-muted-foreground">{label}</dt>
                <dd className={cn("font-semibold tabular-nums", TONES[tone].text)}>{r.phases![k]}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </li>
  );
}
