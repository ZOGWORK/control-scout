// Two or more teams head to head (a "compare" block, server/api/answers/compareBlock.ts), drawn as a table, no bars.
// Two teams mirror the card's header: team A's values on the left, team B's on the right, the stat's name in the
// middle with the gap and a small chip naming who's ahead, under a thin marker pointing that way. Three or four
// teams: a column each. The better value is bold in its team's colour (src/lib/textTones.ts COMPARE_SIDE_TONE, never
// yellow, blue or red), the other muted; a phase's name is in the team page's phase colour.
import { Link } from "react-router-dom";
import type { StatBlock } from "../../../shared/searchStat";
import { COMPARE_SIDE_TONE } from "../../../lib/textTones";
import { OPR_TONE } from "../../oprCards";
import { TONES } from "../../StatTile";
import { cn } from "../../cn";
import { RecordText } from "./answerCells";
import { TAP } from "./TeamAnswer";

type Block = Extract<StatBlock, { kind: "compare" }>;

const side = (i: number) => COMPARE_SIDE_TONE[i % COMPARE_SIDE_TONE.length];
const RECORD = /^\d+-\d+-\d+$/;

function Value({ v, i, best }: { v: string; i: number; best: number | null }) {
  const won = best === i, lost = best != null && !won;
  const body = RECORD.test(v) && !lost ? <RecordText text={v} /> : v;
  return <span className={cn("tabular-nums", won ? cn("font-semibold", side(i).text) : lost ? "text-muted-foreground" : "text-foreground")} data-won={won ? "" : undefined}>{body}</span>;
}

function Label({ row }: { row: Block["rows"][number] }) {
  return <span className={cn("text-xs font-medium", row.phase ? TONES[OPR_TONE[row.phase]].text : "text-foreground")}>{row.label}</span>;
}

export function CompareTable({ b }: { b: Block }) {
  return b.teams.length === 2 ? <TwoSides b={b} /> : <Columns b={b} />;
}

function TwoSides({ b }: { b: Block }) {
  const [A, B] = b.teams;
  return (
    <figure data-block="compare" data-compare-sides="2">
      <figcaption className="mb-1.5 text-xs font-semibold text-muted-foreground">{b.title}</figcaption>
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,auto)_minmax(0,1fr)] items-center gap-x-3 border-b border-border bg-muted/50 px-3 py-1.5 text-xs font-semibold">
          <TeamHead t={A} i={0} />
          <span className="text-center text-[11px] font-medium text-muted-foreground">Gap</span>
          <TeamHead t={B} i={1} right />
        </div>
        {b.rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,auto)_minmax(0,1fr)] items-center gap-x-3 border-t border-border px-3 py-1.5 text-sm first-of-type:border-t-0" data-compare-row={r.label}>
            <span className="text-left text-base"><Value v={r.values[0]} i={0} best={r.best} /></span>
            <span className="flex flex-col items-center gap-0.5 text-center">
              <Label row={r} />
              <Gap row={r} teams={b.teams} />
            </span>
            <span className="text-right text-base"><Value v={r.values[1]} i={1} best={r.best} /></span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function TeamHead({ t, i, right }: { t: Block["teams"][number]; i: number; right?: boolean }) {
  return (
    <Link to={t.href} className={cn("inline-flex items-center gap-1.5 hover:underline", right && "flex-row-reverse justify-self-end", TAP)} data-compare-team={t.label}>
      <span aria-hidden className={cn("size-2 rounded-full", side(i).dot)} />
      <span className={cn("tabular-nums", side(i).text)}>{t.label}</span>
    </Link>
  );
}

/** The gap and who leads, with a thin marker from the centre toward the leader's side (its length the gap's share). */
function Gap({ row, teams }: { row: Block["rows"][number]; teams: Block["teams"] }) {
  if (row.best == null) return row.gap ? <span className="text-[11px] text-muted-foreground">{row.gap}</span> : null;
  const left = row.best === 0, pc = Math.max(8, Math.round(50 * (row.lead ?? 0)));
  return (
    <>
      <span aria-hidden className="relative block h-1 w-24 rounded-full bg-muted" data-gap-marker>
        <span className="absolute inset-y-0 left-1/2 w-px bg-muted-foreground/60" />
        <span className={cn("absolute inset-y-0 rounded-full", side(row.best).dot)} style={left ? { right: "50%", width: `${pc}%` } : { left: "50%", width: `${pc}%` }} />
      </span>
      <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums", side(row.best).chip)} data-gap>
        {row.gap} · {teams[row.best].label}
      </span>
    </>
  );
}

function Columns({ b }: { b: Block }) {
  return (
    <figure data-block="compare" data-compare-sides={b.teams.length}>
      <figcaption className="mb-1.5 text-xs font-semibold text-muted-foreground">{b.title}</figcaption>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left font-medium text-muted-foreground"><span className="sr-only">Stat</span></th>
              {b.teams.map((t, i) => <th key={t.href} scope="col" className="px-3 py-1.5 text-right font-semibold"><span className="inline-flex justify-end"><TeamHead t={t} i={i} right /></span></th>)}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => (
              <tr key={r.label} className="border-t border-border" data-compare-row={r.label}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal"><Label row={r} /></th>
                {r.values.map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-1.5 text-right"><Value v={v} i={i} best={r.best} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
