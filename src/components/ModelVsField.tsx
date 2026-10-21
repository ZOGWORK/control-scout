// Model vs field on the event page's Rankings tab: the biggest gaps between the model's rating order and
// the official seeding (server/api/disagreements.ts, src/shared/disagreements.ts). Each one is a model call
// with its evidence beside it (rating, uncertainty, matches, OPR, record) and its confidence tier, never a
// verdict on a team: seeding also rewards the schedule, partners and ranking points. The model's track
// record sits under it as its credibility. Hidden (with the reason) when the data is thin.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Radar } from "lucide-react";
import { useApi } from "../lib/api";
import type { TrackRecord } from "../shared/api";
import type { DisagreementRow, DisagreementsView } from "../shared/disagreements";
import { TierMark } from "./predict";
import { TeamNo } from "./EventGlance";
import { cn } from "./cn";
import { Button } from "./ui/button";

/** Rows shown per side before "Show more". */
const FIRST = 3;

export const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
};

const MODE_LABEL: Record<DisagreementsView["mode"], string> = {
  quals: "Current seeding",
  final: "Final seeding",
  "pre-quals": "Before quals: seeds from each team's last event",
};

/** The basis in a sentence, said plainly (what the ratings are as of, what the seed is). */
function basis(v: DisagreementsView): string {
  if (v.mode === "pre-quals") return "Ratings from earlier events this season, against each team's seed at its last event (scaled to this field). Seeding here replaces it once qualification matches are played.";
  if (v.ratingsAsOf === "event-end") return "Ratings as they stood at this event's last match, against its final qualification seeding.";
  return "Today's ratings, against the seeding here so far. Both move with every match.";
}

const SIDE = {
  "model-higher": { title: "The model rates them higher than their seed", icon: ArrowUpRight, chip: "bg-success/15 text-success", bar: "bg-success", box: "border-success/30 bg-success/[0.05]" },
  "seed-higher": { title: "Seeded higher than the model rates them", icon: ArrowDownRight, chip: "bg-info/15 text-info", bar: "bg-info", box: "border-info/30 bg-info/[0.05]" },
} as const;

/** An answer of the right shape (an older server, or a stale cache, answers something else). */
const isView = (x: unknown): x is DisagreementsView =>
  !!x && typeof x === "object" && Array.isArray((x as DisagreementsView).rows) && typeof (x as DisagreementsView).compared === "number" && !!(x as DisagreementsView).rules;

export function ModelVsField({ season, code, refreshKey }: { season: number; code: string; refreshKey?: string }) {
  const { data } = useApi<DisagreementsView>(`/api/events/${season}/${encodeURIComponent(code)}/disagreements${refreshKey ? `?v=${encodeURIComponent(refreshKey)}` : ""}`, isView);
  if (!isView(data)) return null; // loading, unavailable or misshapen: the rankings below stand on their own
  if (data.hidden) {
    return (
      <section aria-labelledby="model-vs-field" data-model-vs-field="hidden" className="mb-6 max-sm:mb-4 flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text"><Radar className="size-4" aria-hidden /></span>
        <div className="min-w-0 text-sm">
          <h2 id="model-vs-field" className="font-medium text-foreground">Model vs field</h2>
          <p className="mt-0.5 text-muted-foreground">{data.hidden}</p>
        </div>
      </section>
    );
  }
  const up = data.rows.filter((r) => r.direction === "model-higher");
  const down = data.rows.filter((r) => r.direction === "seed-higher");
  return (
    <section aria-labelledby="model-vs-field" data-model-vs-field className="relative mb-6 max-sm:mb-4 overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 size-60 rounded-full bg-success opacity-10 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-16 -bottom-24 size-60 rounded-full bg-info opacity-10 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-text"><Radar className="size-4" aria-hidden /></span>
          <h2 id="model-vs-field" className="font-display text-lg font-semibold text-foreground">Model vs field</h2>
          <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground" data-mvf-mode={data.mode}>{MODE_LABEL[data.mode]}</span>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Where the model's rating order and the seeding disagree most, across {data.compared} teams. {basis(data)} Seeding also rewards the schedule, partners and ranking points, which a rating of points scored doesn't see.
        </p>
        {data.rows.length === 0 ? (
          <p className="mt-4 rounded-xl border border-border/70 bg-background/40 px-4 py-3 text-sm text-muted-foreground" data-mvf-empty>
            The model's order and the seeding agree here: no team is {data.rules.minGap}+ places apart with a gap the model can tell from its own uncertainty.
          </p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {up.length > 0 && <Side dir="model-higher" rows={up} v={data} />}
            {down.length > 0 && <Side dir="seed-higher" rows={down} v={data} />}
          </div>
        )}
        <Footer v={data} />
      </div>
    </section>
  );
}

function Side({ dir, rows, v }: { dir: DisagreementRow["direction"]; rows: DisagreementRow[]; v: DisagreementsView }) {
  const s = SIDE[dir];
  // The biggest gaps first; the rest a click away, so the rankings below stay close on a phone.
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, FIRST);
  return (
    <div className="min-w-0" data-mvf-side={dir}>
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
        <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", s.chip)}><s.icon className="size-3.5" aria-hidden /></span>
        {s.title}
      </h3>
      <ol className="space-y-2">
        {shown.map((r) => <Row key={r.team} r={r} v={v} />)}
      </ol>
      {rows.length > FIRST && (
        <Button variant="outline" size="sm" className="mt-2" aria-expanded={all} onClick={() => setAll(!all)} data-mvf-more={dir}>
          {all ? "Show fewer" : `Show ${rows.length - FIRST} more`} <ChevronDown className={cn("transition-transform motion-reduce:transition-none", all && "rotate-180")} aria-hidden />
        </Button>
      )}
    </div>
  );
}

const num1 = (x: number) => x.toFixed(1);

function Row({ r, v }: { r: DisagreementRow; v: DisagreementsView }) {
  const s = SIDE[r.direction];
  const n = v.compared;
  // The two places on a strip of the field: the model's call and the seed, the gap filled between them.
  const pos = (place: number) => (n > 1 ? ((place - 1) / (n - 1)) * 100 : 0);
  const a = pos(Math.min(r.modelPlace, r.seedPlace)), b = pos(Math.max(r.modelPlace, r.seedPlace));
  const seedText = r.seed.event
    ? <>seeded {ordinal(r.seed.rank)} of {r.seed.of} at <Link to={`/events/${v.season}/${encodeURIComponent(r.seed.event.code)}`} className="underline decoration-dotted underline-offset-2 hover:text-foreground">{r.seed.event.name}</Link></>
    : <>seeded {ordinal(r.seed.rank)} of {r.seed.of}</>;
  const sentence = r.direction === "model-higher"
    ? <>The model rates them #{r.modelPlace} of {n}; they're {seedText}.</>
    : <>They're {seedText}; the model rates them #{r.modelPlace} of {n}.</>;
  return (
    <li className={cn("rounded-xl border p-3", s.box)} data-mvf-row={r.team}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <TeamNo team={r.team} season={v.season} className="text-base" />
            <span className="min-w-0 truncate text-sm text-foreground">{r.name}</span>
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{sentence}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-display text-2xl font-semibold leading-none tabular-nums", r.direction === "model-higher" ? "text-success" : "text-info")}>{r.gap}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">places</p>
        </div>
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-muted" aria-hidden>
        <div className={cn("absolute inset-y-0 rounded-full opacity-40", s.bar)} style={{ left: `${a}%`, width: `${Math.max(1, b - a)}%` }} />
        <span className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card", s.bar)} style={{ left: `${pos(r.modelPlace)}%` }} />
        <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground/70" style={{ left: `${pos(r.seedPlace)}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden>
        <span>#1</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><span className={cn("size-2 rounded-full", s.bar)} />model</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-foreground/70" />seed</span>
        </span>
        <span>#{n}</span>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div><dt className="inline">Rating </dt><dd className="inline font-medium tabular-nums text-foreground">{num1(r.rating.np)} ± {num1(r.rating.sd)}</dd></div>
        <div><dt className="inline">vs the model's #{r.seedPlace} </dt><dd className="inline font-medium tabular-nums text-foreground">{r.direction === "model-higher" ? "+" : "−"}{num1(r.margin)}</dd></div>
        <div><dd className="inline font-medium tabular-nums text-foreground">{r.rating.matches}</dd><dt className="inline"> matches rated</dt></div>
        {r.opr != null && <div><dt className="inline">{r.oprKind === "season" ? "Season OPR " : "OPR here "}</dt><dd className="inline font-medium tabular-nums text-foreground">{num1(r.opr)}</dd></div>}
        {r.record && <div><dt className="inline">Record </dt><dd className="inline font-medium tabular-nums text-foreground">{r.record.wins}-{r.record.losses}-{r.record.ties}</dd></div>}
        {r.rp != null && <div><dt className="inline">RP </dt><dd className="inline font-medium tabular-nums text-foreground">{num1(r.rp)}</dd></div>}
        <div title={r.reason}><dt className="sr-only">Confidence</dt><dd className="inline"><TierMark tier={r.tier} chip /></dd></div>
      </dl>
    </li>
  );
}

function Footer({ v }: { v: DisagreementsView }) {
  const [open, setOpen] = useState(false);
  const { data: t } = useApi<TrackRecord>("/api/predict/accuracy");
  const s = t?.seasons.find((x) => x.season === v.season);
  // Live calls and replays are never blended: the live record once it's big enough, else the replay, named.
  const live = s?.live && s.live.n >= (t?.liveThreshold ?? Infinity) ? s.live : null;
  const block = live ?? s?.backtest ?? null;
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
      <Link to="/methodology#accuracy" className="group hover:text-foreground" data-mvf-track-record>
        <span className="mr-1.5 inline-block size-1.5 rounded-full bg-success align-middle" aria-hidden />
        {block
          ? <>The same ratings called the winner of {Math.round(block.accuracy * 100)}% of {block.decided.toLocaleString()} {live ? "matches before they were played" : "matches replayed from earlier data (not live calls)"} this season.</>
          : <>Every call the model makes is scored afterwards in public.</>}
        {" "}<span className="underline decoration-dotted underline-offset-2 group-hover:decoration-solid">Track record</span>
      </Link>
      <button type="button" className="inline-flex w-fit items-center gap-1 hover:text-foreground" aria-expanded={open} onClick={() => setOpen(!open)}>
        How these are picked <ChevronDown className={cn("size-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <p className="max-w-3xl" data-mvf-rules>
          Teams with a rating on at least {v.rules.minRatingMatches} matches{v.mode === "pre-quals" ? ` and a seed from an earlier event of ${v.rules.minPriorField}+ teams` : ` and ${v.rules.minQualPlayed}+ qualification matches here`}, in fields of {v.rules.minTeams}+ such teams. A gap shows when it's at least {v.rules.minGap} places and the rating difference to the team the model places at that seed is at least {v.rules.zShow}× their combined uncertainty. Confident from {v.rules.confidentMinMatches}+ rated matches and {v.rules.zConfident}×; provisional under {v.rules.confidentMinMatches} matches. Ratings count points scored without penalties. <Link to="/methodology#confidence" className="underline">How tiers work</Link>
        </p>
      )}
    </div>
  );
}
