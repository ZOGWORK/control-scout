// A stat answer on /search (src/shared/searchStat.ts, from server/api/answers/): the number asked for first, then its
// blocks (numbers side by side, a win-loss bar, matches, tables, a line over events or seasons, bars, links), what it
// counted and from which records. Drawn here from the JSON the server sends; nothing is computed or filled in.
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, CalendarDays, Hash, Info, Medal, Sparkles, Target, Trophy, type LucideIcon } from "lucide-react";
import { eventTypeLabel } from "../../../shared/labels";
import { seasonLabel } from "../../../shared/format";
import { useMemo } from "react";
import type { StatAnswer, StatBlock, StatLink, StatRecord } from "../../../shared/searchStat";
import { teamTableOfLeaderboard } from "../../../shared/teamTable";
import { TeamTable } from "../TeamTable";
import { cn } from "../../cn";
import { Meter, StatTile, TONES, rankPc, type Tone } from "../../StatTile";
import { Badge } from "../../ui/basic";
import { OPR_CARDS, oprRankHint } from "../../oprCards";
import { SEARCH_PALETTE, meaningOf } from "../../../lib/textTones";
import { AnswerFrame, RelatedQuestions, TAP, repeats, statedSeason, useAnswerSeason, useTeamProfile } from "./TeamAnswer";
import { rangeCaption } from "../../../shared/format";
import { AnswerVideo, RowPlay, useRowPlays } from "./AnswerVideo";
import { Cell, EventMarker, HeadlineValue, INK_BAR, MethodNote, TEAM_BAR, TEAM_TEXT, AwardChip, TEAM_SWATCH, swatchOf, type Swatch, RecordText, RichText, SeasonChip, better, columnMax, foldsOnPhone } from "./answerCells";
import { MatchBox, RankBadge, TeamChip } from "./MatchBox";
import { CompareCard, comparisonOf } from "./CompareCard";
import { ChanceBar } from "./ChanceBar";

// Section headers in the team hue (the owner's brief: coloured section headers).
const H3 = "mb-1.5 text-xs font-semibold text-team-a";
/** A tile in search's palette: a thick left bar in its colour over a wash of it (StatTile's border, its left widened). */
const PAINT = "border-l-[6px] border-y-transparent border-r-transparent";
/** A phase's swatch; the total (no phase) in the team hue. */
const sw = (k: string): Swatch => (k in SEARCH_PALETTE ? SEARCH_PALETTE[k as keyof typeof SEARCH_PALETTE] : TEAM_SWATCH[0]);

/** What the card has already said, read off its scope and headline: a block below says none of it again (the guide's
 *  §8, each fact printed once). `has(x)` is true for a number or a phrase it states. */
export function saidBy(stat: StatAnswer) {
  const text = [stat.title, ...stat.scope, stat.headline?.value, stat.headline?.label, stat.headline?.sub].filter(Boolean).join(" · ");
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return { text, has: (x: string) => !!x.trim() && new RegExp(`(^|[^\\w.,#–-])${esc(x.trim())}(?![\\w.,%–-])`, "i").test(text) };
}
type Said = ReturnType<typeof saidBy>;

/** A headline's context: a rank or a percentile, never both (they're the same fact twice), and no season the scope
 *  above already shows. */
export function oneContext(label: string, sub: string | undefined, scope: string[]) {
  const ranked = /#\d[\d,]*\s+of\s+\d/.test(label);
  const lab = ranked ? label.replace(/\s*·\s*top \d+(?:\.\d+)?%/g, "") : label;
  const rest = sub?.split(" · ").filter((x) => !scope.includes(x)).join(" · ");
  return { label: lab, sub: rest || undefined };
}

export function StatAnswerCard({ stat, heading }: { stat: StatAnswer; heading?: string }) {
  // One card in the team page's treatment (./TeamAnswer.tsx): the team (or both teams) up top with the season the
  // answer states, then the answer's title and what it covers, the number asked for big and bold with no band
  // behind it, and its blocks. No hue on data (the search results guide): tiles, bars and marks are neutral.
  // A comparison of teams: its own card, each fact said once (./CompareCard.tsx).
  const cmp = comparisonOf(stat);
  if (cmp) return <CompareCard stat={stat} b={cmp} />;
  return <OneCard stat={stat} heading={heading} />;
}

function OneCard({ stat, heading }: { stat: StatAnswer; heading?: string }) {
  const teams = stat.teams && stat.teams.length > 1 ? stat.teams : stat.team ? [stat.team] : undefined;
  const stated = statedSeason(stat.title, ...stat.scope);
  const season = useAnswerSeason(stated);
  const said = saidBy(stat);
  // About one team: its hue on the card's numbers and bars; about none (a season's top matches): ink.
  const one = teams?.length === 1;
  const profile = useTeamProfile(teams?.length === 1 ? teams[0].number : null, season);
  const scope = !!stat.scope.length && (
    <p className="flex flex-wrap gap-1.5 text-xs" data-scope>
      {stat.scope.map((s) => statedSeason(s) != null && s.length <= 7 ? <SeasonChip key={s} text={s} /> : <span key={s} className="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 font-medium text-foreground/80">{s}</span>)}
    </p>
  );
  return (
    <AnswerFrame teams={teams} profile={profile} season={stated} title={stat.title} hideTitle={repeats(heading, stat.title)} sub={scope || undefined}
      data={{ "data-stat-answer": stat.intent, "data-family": stat.family }}>
      {stat.headline && <Headline h={{ ...stat.headline, ...oneContext(stat.headline.label, stat.headline.sub, stat.scope) }} hue={one} />}
      <AnswerVideo />
      {stat.none && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground" data-none>
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{stat.none}
        </p>
      )}
      <div className="mt-4 space-y-5">{stat.blocks.map((b, i) => <Block key={`${b.kind}-${i}`} b={b} team={stat.team} teams={teams} said={said} hue={one} />)}</div>
      <MethodNote source={stat.source} definition={stat.definition}>
        {stat.more && <p><Link to={stat.more.href} className="inline-flex items-center text-xs font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent-text max-md:min-h-[44px] pointer-coarse:min-h-[44px]" data-more>{stat.more.label}</Link></p>}
      </MethodNote>
    </AnswerFrame>
  );
}

/** The number asked for: big and bold, what it is under it; no band behind it (the team page shows its numbers so). */
function Headline({ h, hue }: { h: NonNullable<StatAnswer["headline"]>; hue?: boolean }) {
  // One event's headline: its type and season as neutral badges (the season leaves the line under it, so it isn't
  // said twice).
  const ev = h.type !== undefined;
  const season = ev ? statedSeason(h.sub) : null;
  const sub = h.sub && season != null ? h.sub.split(" · ").filter((x) => x !== seasonLabel(season)).join(" · ") : h.sub;
  const body = (
    <>
      <p className={cn("break-words font-display text-4xl font-semibold leading-tight tabular-nums group-hover:text-accent-text", hue ? TEAM_TEXT : "text-foreground")}><HeadlineValue value={h.value} win={hue ? TEAM_TEXT : undefined} /></p>
      <p className="mt-1 text-sm text-foreground"><RichText text={h.label} /></p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground"><RichText text={sub} /></p>}
      {ev && (h.type || season != null) && (
        <p className="mt-2 flex flex-wrap gap-1.5" data-headline-chips>
          {h.type && <Badge variant="outline" data-event-type={h.type}>{eventTypeLabel(h.type)}</Badge>}
          {season != null && <SeasonChip text={seasonLabel(season)} />}
        </p>
      )}
    </>
  );
  const cls = cn("group block min-w-0 flex-1 rounded-lg py-1");
  const main = h.href ? <Link to={h.href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
  return (
    <div className="flex gap-3" data-headline>
      <div className="min-w-0 flex-1">
        {main}
        {!!h.teams?.length && h.alliance && (
          <p className="mt-1 flex flex-wrap gap-1" aria-label={`${h.alliance === "red" ? "Red" : "Blue"} alliance`} data-headline-teams>
            {h.teams.map((t) => <TeamChip key={t.href} t={t} side={h.alliance!} />)}
          </p>
        )}
      </div>
    </div>
  );
}

/** A plain number's tile icon, by what it counts; the tile itself neutral (no hue for a kind of number). */
function kpiLook(label: string, _tone?: string): [LucideIcon, Tone] {
  const icon: LucideIcon = /win|record|loss|won|lost/i.test(label) ? Trophy : /rank|#|place/i.test(label) ? Hash : /season|year|date|when/i.test(label) ? CalendarDays
    : /rating/i.test(label) ? Sparkles : /award/i.test(label) ? Medal : /opr|score|points|margin/i.test(label) ? Target : BarChart3;
  return [icon, "neutral"];
}

/** The compared team a tile is about (its label names the team: "Ultraviolet (23268)", "4215 wins"), or -1. */
function teamOf(label: string, teams: { number: number }[]): number {
  return teams.findIndex((t) => new RegExp(`(^|\\(|\\s)${t.number}(\\)|\\s|$)`).test(label));
}

function Block({ b: block, team, teams, said, hue }: { b: StatBlock; team?: StatAnswer["team"]; teams?: { number: number; name: string | null }[]; said?: Said; hue?: boolean }) {
  const bar = hue ? TEAM_BAR : INK_BAR;
  // A tile that says nothing the headline or scope doesn't (its number, and its line and rank too: the headline's
  // number, its win rate, the season): left out. A tile with anything more (a rank, a count) stays.
  const fmt = (n: number) => n.toLocaleString("en-US");
  // The same number of the same thing: its value and what it measures (its label, or a season the scope shows).
  const told = (k: Extract<StatBlock, { kind: "kpis" }>["items"][number]) => !!said && said.has(String(k.value))
    && (said.has(k.label) || statedSeason(String(k.value)) != null) && (!k.sub || said.has(k.sub))
    && (k.rank == null || said.has(`#${fmt(k.rank)}${k.of != null ? ` of ${fmt(k.of)}` : ""}`));
  const b: StatBlock = block.kind === "kpis" && said && !(teams && teams.length > 1)
    ? { ...block, items: block.items.filter((k) => !told(k)) } : block;
  switch (b.kind) {
    case "kpis": {
      if (!b.items.length) return null;
      if (b.items.some((k) => k.phase)) return <OprTiles items={b.items} teams={teams} />;
      // Two or more teams: each team's tile under its own header (A left, B right), anything about both between them.
      const sides = teams && teams.length > 1 ? b.items.map((k) => teamOf(k.label, teams)) : [];
      if (teams && sides.length && teams.every((_, i) => sides.includes(i))) {
        const n = teams.length;
        const order = b.items.map((k, j) => ({ k, s: sides[j] })).sort((x, y) => (x.s < 0 ? (n - 1) / 2 : x.s) - (y.s < 0 ? (n - 1) / 2 : y.s));
        const cols = order.length === 2 ? "grid-cols-2" : order.length === 3 ? "grid-cols-3" : "grid-cols-2 lg:grid-cols-4";
        return (
          <div className={cn("grid gap-3", cols)} data-block="kpis" data-kpi-sides>
            {order.map(({ k, s }, j) => {
              const [icon, tone] = kpiLook(k.label, k.tone);
              const right = order.length === 2 && j === 1;
              // A tile about one team in that team's hue (its name never read as an award or a phase: "Control Freaks");
              // one about both in its meaning's colour, else team A's.
              const sw = s >= 0 ? TEAM_SWATCH[Math.min(s, 2)] : swatchOf(k.label);
              const value = <span className={sw.text}>{k.value}</span>;
              const tile = <StatTile tone={tone} icon={icon} label={k.label} value={value} hint={k.sub} chip={sw.fill} className={cn(PAINT, sw.edge, sw.tint, right && "items-end text-right")} />;
              const phase = meaningOf(k.label) ?? undefined;
              return k.href
                ? <Link key={k.label} to={k.href} className="block rounded-xl transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0" data-kpi data-side={s} data-phase={phase}>{tile}</Link>
                : <div key={k.label} data-kpi data-side={s} data-phase={phase}>{tile}</div>;
            })}
          </div>
        );
      }
      return (
        <div className={cn("grid gap-3", b.items.length === 1 ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" : b.items.length === 3 ? "grid-cols-2 lg:grid-cols-3" : "grid-cols-2 lg:grid-cols-4")} data-block="kpis">
          {b.items.map((k) => {
            const [icon, tone] = kpiLook(k.label, k.tone);
            // Each tile in its meaning's colour (an award, a phase), else the team's: a thick left bar, a filled icon, the number in it.
            const phase = meaningOf(k.label) ?? undefined;
            const sw = swatchOf(k.label);
            const value = <span className={sw.text}>{k.value}</span>;
            const tile = <StatTile tone={tone} icon={icon} label={k.label} value={value} hint={k.sub} chip={sw.fill} className={cn(PAINT, sw.edge, sw.tint)} />;
            return k.href
              ? <Link key={k.label} to={k.href} className="block rounded-xl transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0" data-kpi data-phase={phase}>{tile}</Link>
              : <div key={k.label} data-kpi data-phase={phase}>{tile}</div>;
          })}
        </div>
      );
    }
    case "compare":
      // Only inside a card of several answers (a combined card): the comparison's own rows.
      return <CompareCard stat={{ family: "two-team", intent: "compare", title: b.title, scope: [], blocks: [], definition: "", source: "", teams: b.teams.map((t) => ({ number: Number(t.label), name: null })) }} b={b} />;
    case "record": {
      const n = b.wins + b.losses + b.ties;
      const w = (x: number) => `${n ? (100 * x) / n : 0}%`;
      return (
        <figure data-block="record">
          {b.title && <figcaption className={H3}>{b.title}</figcaption>}
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${b.wins} wins, ${b.losses} losses, ${b.ties} ties`}>
            <span className={TEAM_BAR} style={{ width: w(b.wins) }} data-bar data-value={b.wins} data-scale={n} />
            <span className="bg-team-a/40" style={{ width: w(b.losses) }} data-bar data-value={b.losses} data-scale={n} />
            <span className="bg-team-a/20" style={{ width: w(b.ties) }} data-bar data-value={b.ties} data-scale={n} />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs tabular-nums text-foreground" aria-hidden>
            <span><b>{b.wins}</b> won</span><span><b>{b.losses}</b> lost</span><span><b>{b.ties}</b> tied</span>
            {n > 0 && !said?.has(`${Math.round((100 * b.wins) / n)}%`) && <span className="text-muted-foreground">{Math.round((100 * b.wins) / n)}% win rate</span>}
          </p>
          {b.split && <RecordSplit split={b.split} bar={bar} />}
        </figure>
      );
    }
    case "matches": {
      // Every match at one event: the event, its type and season said once, over the list, not in every box (§8).
      const ev = b.rows.length > 1 && b.rows.every((r) => r.event.href === b.rows[0].event.href && r.season === b.rows[0].season) ? b.rows[0] : null;
      return (
        <div data-block="matches">
          <h3 className={H3}>
            {b.title}
            {ev && <> · <Link to={ev.event.href} className="text-foreground/90 hover:text-accent-text hover:underline">{ev.event.label}</Link></>}
            {ev && !!ev.type && <EventMarker type={ev.type} chip />}
            {ev && !said?.has(ev.season) && <> · {ev.season}</>}
          </h3>
          <ul className={cn("grid gap-3", b.rows.length > 1 && "lg:grid-cols-2")}>{b.rows.map((r) => <MatchBox key={`${r.href}|${r.alliance}`} r={r} team={team ?? undefined} atEvent={!!ev} />)}</ul>
          {b.more && <p className="mt-1 text-[11px] text-muted-foreground">{b.more}</p>}
        </div>
      );
    }
    case "table":
      return b.rows.some((r) => r.teams) ? <MatchTable b={b} /> : <Table b={b} />;
    case "leaderboard":
      return <Leaderboard b={b} />;
    case "series":
      return <Series b={b} />;
    case "bars":
      return <Bars b={b} />;
    case "links":
      return (
        <nav aria-label={b.title} data-block="links">
          <h3 className={H3}>{b.title}</h3>
          {b.items.length ? (
            <ul className="flex flex-wrap gap-2">
              {b.items.map((l) => (
                <li key={l.href}><Link to={l.href} className="inline-flex min-h-9 max-md:min-h-[44px] pointer-coarse:min-h-[44px] items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground hover:border-accent/60 hover:text-accent-text">{l.label}{l.sub && <span className="text-[11px] font-normal text-muted-foreground">{l.sub}</span>}<ArrowRight className="size-3.5 text-muted-foreground" aria-hidden /></Link></li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{b.none}</p>}
        </nav>
      );
    case "related":
      return <RelatedQuestions queries={b.queries} title={b.title} />;
    case "chance":
      return <ChanceBar b={b} />;
  }
}

/** A season OPR and its phases as the team page's OPR tiles, each in that page's colour for it, with its rank line and bar. */
function OprTiles({ items, teams }: { items: Extract<StatBlock, { kind: "kpis" }>["items"]; teams?: { number: number }[] }) {
  // Two teams' tiles for one phase: one column each, under its own header (A left, B right).
  const many = !!teams && teams.length > 1 && OPR_CARDS.some(([k]) => items.filter((i) => i.phase === k).length > 1);
  return (
    <div className={cn("grid gap-3", many ? (teams!.length === 2 ? "grid-cols-2" : "grid-cols-3") : "grid-cols-2 lg:grid-cols-4")} data-block="kpis" data-opr-tiles>
      {OPR_CARDS.flatMap(([k, label, Icon]) => {
        const tone: Tone = "neutral";
        // Two teams' tiles for one phase (a phase side by side) each name their team.
        const its = items.filter((i) => i.phase === k);
        return its.map((it, n) => (
          // Each phase in search's palette colour for it: a thick left bar, a filled icon, the number and bar in it.
          <div key={`${k}-${n}`} className="min-w-0" data-phase={k}><StatTile tone={tone} icon={Icon} label={its.length > 1 ? `${label} · ${it.label}` : label}
            chip={sw(k).fill} className={cn(PAINT, sw(k).edge, sw(k).tint)}
            value={<span className={sw(k).text}>{it.value}</span>}
            hint={it.rank == null && it.pc != null ? it.sub : oprRankHint(it.rank, it.of)}
            bar={<Meter parts={[{ pc: it.rank == null && it.pc != null ? it.pc : rankPc(it.rank, it.of), cls: sw(k).bar }]} />} /></div>
        ));
      })}
    </div>
  );
}

/** The same record as qualifications and playoffs, a row each: W-L-T, win rate and matches, its own small bar. */
function RecordSplit({ split, bar = INK_BAR }: { split: { quals: StatRecord; playoffs: StatRecord }; bar?: string }) {
  const rows: [string, StatRecord][] = [["Qualifications", split.quals], ["Playoffs", split.playoffs]];
  return (
    <table className="mt-3 w-full overflow-hidden rounded-lg border border-border text-sm tabular-nums" data-record-split>
      <thead className="bg-muted/50 text-xs text-muted-foreground">
        <tr><th scope="col" className="px-3 py-2 text-left font-semibold">Matches</th><th scope="col" className="px-3 py-2 text-right font-semibold">W-L-T</th><th scope="col" className="px-3 py-2 text-right font-semibold">Win rate</th><th scope="col" className="px-3 py-2 text-right font-semibold max-sm:hidden">Played</th></tr>
      </thead>
      <tbody>
        {rows.map(([label, r]) => {
          const n = r.wins + r.losses + r.ties;
          const pc = n ? Math.round((100 * r.wins) / n) : 0;
          return (
            <tr key={label} className="border-t border-border" data-split={label}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                {label}
                <span className="mt-1 block h-1.5 w-full max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden><span className={cn("block h-full", bar)} style={{ width: `${n ? (100 * r.wins) / n : 0}%` }} data-bar data-value={r.wins} data-scale={n} /></span>
              </th>
              <td className="px-3 py-2 text-right font-semibold text-foreground"><RecordText text={`${r.wins}-${r.losses}-${r.ties}`} /></td>
              <td className="px-3 py-2 text-right text-foreground">{pc}%</td>
              <td className="px-3 py-2 text-right text-muted-foreground max-sm:hidden">{n}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Rows of named columns, each cell as ./answerCells.tsx reads it: ranks as pills, records with the wins bold, an OPR
 *  with a neutral bar from zero to the best listed, seasons and event types as badges. On a phone
 *  an event's season and date fold under its name, so the columns left are numbers (the team page's phone rows). Two
 *  teams side by side (columns `a` and `b`): each row's better number is bold with a trophy (no hue). */
function Table({ b }: { b: Extract<StatBlock, { kind: "table" }> }) {
  const first = b.columns[0];
  const max = new Map(b.columns.map((c) => [c.key, columnMax(c, b.rows.map((r) => r.cells[c.key]))]));
  const folded = b.columns.filter((c) => foldsOnPhone(c, first));
  const vs = b.columns.some((c) => c.key === "a") && b.columns.some((c) => c.key === "b");
  const plays = useRowPlays(b.rows.map((r) => r.href));
  return (
    <div data-block="table">
      {/* A table that is the whole answer has no heading of its own: the card's title already says it. */}
      {b.title && <h3 className={H3}>{b.title}</h3>}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
            <tr>{b.columns.map((c) => <th key={c.key} scope="col" className={cn("px-2.5 py-1.5 font-medium", c.num && "text-right", c !== first && "whitespace-nowrap max-md:px-1.5", folded.includes(c) && "max-md:hidden")}>{c.label}</th>)}{plays && <th scope="col" className="w-0 px-1"><span className="sr-only">Video</span></th>}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, i) => {
              const win = vs ? better(String(r.cells[first.key] ?? ""), r.cells.a, r.cells.b) : null;
              return (
                // A row that is an award (or a phase): a thick left bar in its colour, its name a filled chip.
                <tr key={i} className={cn("border-t border-border", r.strong && "font-semibold")} data-strong={r.strong ? "" : undefined} data-meaning={meaningOf(String(r.cells[first.key] ?? "")) ?? undefined}>
                  {b.columns.map((c, j) => {
                    const v = r.cells[c.key];
                    const won = win === c.key;
                    return (
                      <td key={c.key} className={cn("px-2.5 py-1.5 align-middle", c.num && "text-right tabular-nums", j === 0 && meaningOf(String(v ?? "")) && cn("border-l-[6px]", swatchOf(String(v)).edge), j === 0 ? "min-w-[4.5rem] md:min-w-[8rem]" : "whitespace-nowrap max-md:px-1.5", folded.includes(c) && "max-md:hidden", won && "font-bold text-foreground")} data-better={won ? "" : undefined}>
                        {j === 0 && r.strong && <Trophy className="mr-1 inline size-3.5 align-[-2px] text-team-a" aria-label="Best" />}
                        {j === 0 && r.href
                          ? <Link to={r.href} className="text-foreground hover:text-accent-text hover:underline max-md:inline-flex max-md:min-h-[44px] max-md:items-center pointer-coarse:inline-flex pointer-coarse:min-h-[44px] pointer-coarse:items-center">{c.key === "award" && v != null ? <AwardChip name={String(v)} /> : (v ?? "–")}</Link>
                          : j === 0 && c.key === "award" && v != null ? <AwardChip name={String(v)} />
                          : j === 0 ? (v ?? "–") : <Cell col={c} value={v} max={max.get(c.key)} />}
                        {j === 0 && first.key === "event" && !!r.type && <EventMarker type={r.type} chip />}
                        {won && <Trophy className="ml-1 inline size-3 align-[-1px] text-team-a" aria-label="Better" />}
                        {j === 0 && !!folded.length && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] font-normal text-muted-foreground md:hidden" data-folded>
                            {folded.map((f) => r.cells[f.key] != null && <span key={f.key}>{f.key === "season" ? <SeasonChip text={String(r.cells[f.key])} /> : r.cells[f.key]}</span>)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {plays && <td className="w-0 px-1 py-0.5 align-middle">{r.href && <RowPlay href={r.href} label={[r.cells.match, r.cells.event].filter(Boolean).join(" · ") || "This match"} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {b.more && <p className="mt-1 text-[11px] text-muted-foreground">{b.more}</p>}
    </div>
  );
}

/** Matches in a table with both alliances' teams (a season's top combined scores): a row each, its place as a podium
 *  badge, the number it ranks by with a thin neutral bar from zero to the top one (never a cut baseline), the
 *  red and blue scores in their colours (the winner bold), the match, its event with its type, and both alliances as
 *  team chips. On a phone each row is two lines: the numbers and the match, then the event and the teams. */
function MatchTable({ b }: { b: Extract<StatBlock, { kind: "table" }> }) {
  const key = b.columns.find((c) => c.num && c.key !== "rank")?.key ?? "combined";
  const vs = b.rows.map((r) => Number(r.cells[key])).filter(Number.isFinite);
  const hi = Math.max(0, ...vs);
  const pc = (v: number) => (hi > 0 ? (100 * Math.max(0, v)) / hi : 0);
  const label = b.columns.find((c) => c.key === key)?.label ?? "";
  return (
    <div data-block="table" data-match-table>
      <h3 className={H3}>{b.title}</h3>
      <ul className="overflow-hidden rounded-lg border border-border">
        <li className="flex items-center gap-x-3 bg-muted/50 px-3 py-1.5 text-[11px] font-medium text-muted-foreground max-md:hidden" aria-hidden>
          <span className="w-6">#</span><span className="w-20 text-right">{label}</span><span className="w-24 text-center">Red–Blue</span><span className="w-16">Match</span><span className="flex-1">Event</span><span>Red vs blue</span>
        </li>
        {b.rows.map((r, i) => {
          const v = Number(r.cells[key]);
          const [red, blue] = String(r.cells.score ?? "").split("–").map(Number);
          // The official winner (penalties included) when the row says it, else the scores shown.
          const won = r.winner !== undefined ? r.winner : red > blue ? "red" : blue > red ? "blue" : null;
          return (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-3 py-2 text-sm first:border-t-0" data-match-row>
              <RankBadge rank={Number(r.cells.rank) || i + 1} />
              <span className="w-20 shrink-0 text-right" data-combined>
                <b className="block font-display text-lg font-semibold leading-tight tabular-nums text-foreground">{r.cells[key]}</b>
                {Number.isFinite(v) && <span aria-hidden className="flex h-1 w-full overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", INK_BAR)} style={{ width: `${pc(v)}%` }} data-bar data-value={v} data-scale={hi} /></span>}
              </span>
              <span className="w-24 shrink-0 text-center tabular-nums" aria-label={`Red ${red}, blue ${blue}`}>
                <span className={won === "blue" ? "text-muted-foreground" : "font-bold text-red-alliance-text"}>{red}</span><span className="text-muted-foreground">–</span><span className={won === "red" ? "text-muted-foreground" : "font-bold text-blue-alliance-text"}>{blue}</span>
              </span>
              {r.href ? <Link to={r.href} className={cn("inline-flex w-16 shrink-0 items-center font-medium text-foreground hover:text-accent-text hover:underline", TAP)}>{r.cells.match}</Link> : <span className="w-16 shrink-0">{r.cells.match}</span>}
              <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-3 gap-y-1 max-md:pl-9 md:basis-0 md:flex-1">
                <span className="min-w-0 flex-1 basis-48 text-xs">
                  {r.eventHref ? <Link to={r.eventHref} className={cn("inline-flex items-center font-medium text-foreground/90 hover:text-accent-text hover:underline", TAP)}>{r.cells.event}</Link> : r.cells.event}
                  {!!r.type && <EventMarker type={r.type} chip />}
                  {r.cells.date && <span className="text-muted-foreground"> · {r.cells.date}</span>}
                </span>
                {r.teams && (
                  <span className="flex flex-wrap gap-1" data-teams>
                    {r.teams.red.map((t) => <NumChip key={t.href} t={t} side="red" />)}
                    <span className="self-center text-[11px] text-muted-foreground">vs</span>
                    {r.teams.blue.map((t) => <NumChip key={t.href} t={t} side="blue" />)}
                  </span>
                )}
                {r.href && <RowPlay href={r.href} label={`${r.cells.match} · ${r.cells.event}`} className="-my-1 -mr-1" />}
              </span>
            </li>
          );
        })}
      </ul>
      {b.more && <p className="mt-1 text-[11px] text-muted-foreground">{b.more}</p>}
    </div>
  );
}

/** A team as its number alone, in its alliance's colour, its name on hover and for screen readers. */
function NumChip({ t, side }: { t: StatLink; side: "red" | "blue" }) {
  const num = t.label.split(" ")[0];
  return <Link to={t.href} title={t.label} aria-label={t.label} className={cn("inline-flex min-h-6 items-center rounded-md border px-1.5 text-xs font-semibold tabular-nums hover:underline", TAP, side === "red" ? "border-red-alliance/30 bg-red-alliance/10 text-red-alliance-text" : "border-blue-alliance/30 bg-blue-alliance/10 text-blue-alliance-text")} data-team-chip={num}>{num}</Link>;
}

/** A line through the points (oldest first); each point a link when it has one. Points with no value are skipped. */
function Series({ b }: { b: Extract<StatBlock, { kind: "series" }> }) {
  const pts = b.points.map((p, i) => ({ ...p, i })).filter((p) => p.y != null) as ({ i: number; y: number } & (typeof b.points)[number])[];
  if (!pts.length) return null;
  const lo = Math.min(...pts.map((p) => p.y)), hi = Math.max(...pts.map((p) => p.y));
  const x = (i: number) => (b.points.length === 1 ? 50 : 4 + (i / (b.points.length - 1)) * 92);
  const y = (v: number) => (hi === lo ? 50 : 88 - ((v - lo) / (hi - lo)) * 76);
  return (
    <figure data-block="series">
      <figcaption className={H3}>{b.title}</figcaption>
      <div className="relative h-32 rounded-lg border border-border bg-muted/20">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
          {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.i)},${y(p.y)}`).join(" ")} fill="none" className="stroke-team-a" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        </svg>
        {pts.map((p) => {
          // In the team hue, the latest point larger and filled.
          const last = p.i === pts[pts.length - 1].i;
          const dot = <span className={cn("block rounded-full border-2 border-team-a", last ? "size-4 bg-team-a" : "size-3 bg-card")} />;
          const style = { left: `${x(p.i)}%`, top: `${y(p.y)}%` };
          const label = `${p.x}: ${p.y}${b.unit ? ` ${b.unit}` : ""}${p.note ? ` (${p.note})` : ""}`;
          return p.href
            ? <Link key={p.i} to={p.href} style={style} title={label} aria-label={label} className="absolute flex size-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center hover:[&>span]:bg-accent">{dot}</Link>
            : <span key={p.i} style={style} title={label} aria-label={label} role="img" className="absolute flex size-[24px] -translate-x-1/2 -translate-y-1/2 items-center justify-center">{dot}</span>;
        })}
      </div>
      {/* Every event's full name is in the list below: no cut-off names under the line. */}
      <p className="mt-1 text-[11px] text-muted-foreground">{rangeCaption(lo, hi, pts.length, b.unit)}</p>
      {/* Every point's value in words too: readable without hovering (phones), and by screen readers. */}
      <ol className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2" data-series-values>
        {b.points.map((p, i) => (
          <li key={i} className="flex min-w-0 items-center justify-between gap-2 border-b border-border/60 py-0.5">
            {p.href ? <Link to={p.href} className="min-w-0 break-words text-muted-foreground hover:text-accent-text hover:underline max-md:flex max-md:min-h-[44px] max-md:items-center pointer-coarse:flex pointer-coarse:min-h-[44px] pointer-coarse:items-center">{p.x}</Link> : <span className="min-w-0 break-words text-muted-foreground">{p.x}</span>}
            <span className="shrink-0 tabular-nums text-foreground">{p.y ?? "–"}{p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

function Bars({ b }: { b: Extract<StatBlock, { kind: "bars" }> }) {
  // One group's values are small tiles (a phase's in the team page's colour for it); several groups a compact table, a row each.
  const fmt = (v: number | null) => (v == null ? "–" : `${Number.isInteger(v) ? v : v.toFixed(1)}${b.unit === "%" ? "%" : ""}`);
  // A team's value (tone a, b, c: a prediction's two teams) in that team's hue; the rest by what the label means.
  const sw = (i: { label: string; tone?: string }): Swatch => (i.tone && i.tone !== "d" ? TEAM_SWATCH["abc".indexOf(i.tone)] : swatchOf(i.label));
  if (b.groups.length === 1) {
    const g = b.groups[0];
    return (
      <figure data-block="bars">
        <figcaption className={H3}>{b.title}</figcaption>
        <dl className={cn("grid gap-2", g.items.length <= 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
          {g.items.map((i) => (
            <div key={i.label} className={cn("rounded-lg border px-3 py-2", PAINT, sw(i).edge, sw(i).tint)} data-bar-value={i.label} data-phase={(!i.tone && meaningOf(i.label)) || undefined}>
              <dt className={cn("text-xs font-semibold", sw(i).text)}>{i.label}</dt>
              <dd className={cn("font-display text-xl font-semibold tabular-nums", sw(i).text)}>{fmt(i.value)}</dd>
            </div>
          ))}
        </dl>
      </figure>
    );
  }
  const labels = [...new Set(b.groups.flatMap((g) => g.items.map((i) => i.label)))];
  return (
    <figure data-block="bars">
      <figcaption className={H3}>{b.title}</figcaption>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-[11px] text-muted-foreground"><tr><th scope="col" className="px-2.5 py-1.5 text-left font-medium"><span className="sr-only">Group</span></th>{labels.map((l) => <th key={l} scope="col" className="px-2.5 py-1.5 text-right font-medium">{l}</th>)}</tr></thead>
          <tbody>
            {b.groups.map((g) => (
              <tr key={g.label} className="border-t border-border">
                <th scope="row" className="px-2.5 py-1.5 text-left text-xs font-medium text-foreground">{g.label}</th>
                {labels.map((l) => <td key={l} className="px-2.5 py-1.5 text-right tabular-nums">{fmt(g.items.find((i) => i.label === l)?.value ?? null)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** A leaderboard: the asked stat's teams as the search's one team table (../TeamTable.tsx), sorted by the stat asked
 *  (the list's own order when it isn't an OPR), with its note above and the small "View more detail" link under it. */
function Leaderboard({ b }: { b: Extract<StatBlock, { kind: "leaderboard" }> }) {
  const table = useMemo(() => teamTableOfLeaderboard(b.stat.id, b.stat.label, b.rows, b.teleopWithEndgame, b.lowest), [b]);
  return (
    <figure data-block="leaderboard">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={H3}>{b.title}</span>
        <span className="text-[11px] text-muted-foreground" data-note>{b.note}</span>
      </figcaption>
      <TeamTable table={table} label={b.title} />
      {b.more && <p className="mt-2"><Link to={b.more.href} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent-text max-md:min-h-[44px] pointer-coarse:min-h-[44px]" data-more-detail>{b.more.label}<ArrowRight className="size-3.5" aria-hidden /></Link></p>}
    </figure>
  );
}
