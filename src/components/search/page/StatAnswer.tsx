// A stat answer on /search (src/shared/searchStat.ts, from server/api/answers/): the number asked for first, then its
// blocks (numbers side by side, a win-loss bar, matches, tables, a line over events or seasons, bars, links), what it
// counted and from which records. Drawn here from the JSON the server sends; nothing is computed or filled in.
import { Link } from "react-router-dom";
import { ArrowRight, BarChart3, Info, Search } from "lucide-react";
import { useMemo } from "react";
import type { StatAnswer, StatBlock, StatMatchRow } from "../../../shared/searchStat";
import { teamTableOfLeaderboard } from "../../../shared/teamTable";
import { TeamTable } from "../TeamTable";
import { cn } from "../../cn";
import { Meter, StatTile, TONES, rankPc } from "../../StatTile";
import { OPR_CARDS, oprRankHint } from "../../oprCards";
import { rangeCaption } from "../../../shared/format";

const H3 = "mb-1.5 text-xs font-semibold text-muted-foreground";

export function StatAnswerCard({ stat }: { stat: StatAnswer }) {
  // A team's season OPR (or one phase's) is drawn as the team page draws it: its plain card and section header, the
  // number with no band behind it, and the phases as its coloured OPR tiles (../../oprCards.ts).
  const opr = stat.blocks.some((b) => b.kind === "kpis" && b.items.some((i) => i.phase));
  const scope = !!stat.scope.length && (
    <p className="mt-1.5 flex flex-wrap gap-1 text-[11px]" data-scope>
      {stat.scope.map((s) => <span key={s} className="rounded-full bg-accent/[0.1] px-2 py-0.5 font-medium text-accent-text">{s}</span>)}
    </p>
  );
  return (
    <section aria-label={stat.title} className={cn("mb-5 rounded-xl border bg-card p-4 shadow-sm sm:p-5", opr ? "border-border" : "border-accent/30")} data-stat-answer={stat.intent} data-family={stat.family}>
      {opr ? (
        <div className="border-b border-border pb-3">
          <h2 className="text-base font-semibold text-foreground">{stat.title}</h2>
          {scope}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <BarChart3 className="size-4 text-accent" aria-hidden />
            <h2 className="font-display text-base font-semibold text-foreground">{stat.title}</h2>
          </div>
          {scope}
        </>
      )}
      {stat.headline && <Headline h={stat.headline} plain={opr} />}
      {stat.none && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground" data-none>
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{stat.none}
        </p>
      )}
      <div className="mt-3 space-y-4">{stat.blocks.map((b, i) => <Block key={`${b.kind}-${i}`} b={b} />)}</div>
      <footer className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted-foreground" data-definition>
        <p><span className="font-medium text-foreground">How this is counted: </span>{stat.definition}</p>
        <p data-source>{stat.source}.</p>
        {stat.more && <p><Link to={stat.more.href} className="inline-flex items-center text-[11px] text-accent-text hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]" data-more>{stat.more.label}</Link></p>}
      </footer>
    </section>
  );
}

/** `plain`: no band behind it (the OPR answer, as the team page shows its OPR). */
function Headline({ h, plain }: { h: NonNullable<StatAnswer["headline"]>; plain?: boolean }) {
  const body = (
    <>
      <p className="break-words font-display text-3xl font-semibold leading-tight tabular-nums text-foreground group-hover:text-accent-text">{h.value}</p>
      <p className="mt-1 text-sm text-foreground">{h.label}</p>
      {h.sub && <p className="mt-0.5 text-xs text-muted-foreground">{h.sub}</p>}
    </>
  );
  const cls = plain ? "group mt-3 block rounded-lg py-1" : "group mt-3 block rounded-lg bg-accent/[0.06] px-3 py-3";
  return h.href ? <Link to={h.href} className={cn(cls, !plain && "hover:bg-accent/[0.1]")} data-headline>{body}</Link> : <div className={cls} data-headline>{body}</div>;
}

function Block({ b }: { b: StatBlock }) {
  switch (b.kind) {
    case "kpis":
      if (b.items.some((k) => k.phase)) return <OprTiles items={b.items} />;
      return (
        <dl className={cn("grid gap-2", b.items.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3")} data-block="kpis">
          {b.items.map((k) => {
            const inner = (
              <>
                <dt className="text-[11px] text-muted-foreground">{k.label}</dt>
                <dd className={cn("mt-0.5 font-display text-lg font-semibold tabular-nums leading-tight", k.tone === "good" ? "text-success-text" : k.tone === "bad" ? "text-danger-text" : k.tone === "accent" ? "text-accent-text" : "text-foreground")}>{k.value}</dd>
                {k.sub && <dd className="text-[11px] text-muted-foreground">{k.sub}</dd>}
              </>
            );
            return k.href
              ? <Link key={k.label} to={k.href} className="rounded-lg border border-border px-3 py-2 hover:border-accent/60">{inner}</Link>
              : <div key={k.label} className="rounded-lg border border-border px-3 py-2">{inner}</div>;
          })}
        </dl>
      );
    case "record": {
      const n = b.wins + b.losses + b.ties;
      const w = (x: number) => `${n ? (100 * x) / n : 0}%`;
      return (
        <figure data-block="record">
          {b.title && <figcaption className={H3}>{b.title}</figcaption>}
          <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${b.wins} wins, ${b.losses} losses, ${b.ties} ties`}>
            <span className="bg-success" style={{ width: w(b.wins) }} />
            <span className="bg-danger" style={{ width: w(b.losses) }} />
            <span className="bg-muted-foreground/50" style={{ width: w(b.ties) }} />
          </div>
          <p className="mt-1.5 flex flex-wrap gap-x-4 text-xs tabular-nums text-foreground" aria-hidden>
            <span><b className="text-success-text">{b.wins}</b> won</span><span><b className="text-danger-text">{b.losses}</b> lost</span><span><b>{b.ties}</b> tied</span>
            {n > 0 && <span className="text-muted-foreground">{Math.round((100 * b.wins) / n)}% win rate</span>}
          </p>
        </figure>
      );
    }
    case "matches":
      return (
        <div data-block="matches">
          <h3 className={H3}>{b.title}</h3>
          <ul className="overflow-hidden rounded-lg border border-border">{b.rows.map((r) => <MatchRow key={`${r.href}|${r.alliance}`} r={r} />)}</ul>
          {b.more && <p className="mt-1 text-[11px] text-muted-foreground">{b.more}</p>}
        </div>
      );
    case "table":
      return (
        <div data-block="table">
          <h3 className={H3}>{b.title}</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
                <tr>{b.columns.map((c) => <th key={c.key} scope="col" className={cn("px-2.5 py-1.5 font-medium", c.num && "text-right")}>{c.label}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, i) => (
                  <tr key={i} className={cn("border-t border-border", r.strong && "bg-accent/[0.07] font-medium")}>
                    {b.columns.map((c, j) => (
                      <td key={c.key} className={cn("px-2.5 py-1.5 align-top", c.num && "text-right tabular-nums", j === 0 && "min-w-[8rem]")}>
                        {j === 0 && r.href ? <Link to={r.href} className="text-foreground hover:text-accent-text hover:underline">{r.cells[c.key] ?? "–"}</Link> : (r.cells[c.key] ?? "–")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.more && <p className="mt-1 text-[11px] text-muted-foreground">{b.more}</p>}
        </div>
      );
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
      return (
        <nav aria-label={b.title} data-block="related">
          <h3 className={H3}>{b.title}</h3>
          <ul className="flex flex-wrap gap-1.5">
            {b.queries.map((q) => (
              <li key={q}><Link to={`/search?q=${encodeURIComponent(q)}`} className="inline-flex min-h-8 max-md:min-h-[44px] pointer-coarse:min-h-[44px] items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.06] px-3 text-xs font-medium text-foreground hover:border-accent/60"><Search className="size-3.5 text-accent" aria-hidden />{q}</Link></li>
            ))}
          </ul>
        </nav>
      );
  }
}

/** A season OPR and its phases as the team page's OPR tiles: each in its phase's colour, with its rank line and bar. */
function OprTiles({ items }: { items: Extract<StatBlock, { kind: "kpis" }>["items"] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-block="kpis" data-opr-tiles>
      {OPR_CARDS.map(([k, label, Icon, tone]) => {
        const it = items.find((i) => i.phase === k);
        if (!it) return null;
        return (
          <StatTile key={k} tone={tone} icon={Icon} label={label}
            value={<span className={TONES[tone].text}>{it.value}</span>}
            hint={oprRankHint(it.rank, it.of)}
            bar={<Meter parts={[{ pc: rankPc(it.rank, it.of), cls: TONES[tone].bar }]} />} />
        );
      })}
    </div>
  );
}

function MatchRow({ r }: { r: StatMatchRow }) {
  const tone = r.result === "W" ? "bg-success/15 text-success-text" : r.result === "L" ? "bg-danger/15 text-danger-text" : "bg-muted text-foreground";
  return (
    <li className="border-t border-border first:border-t-0">
      <div className="flex items-start gap-2.5 px-3 py-2">
        <span className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold", tone)} aria-label={r.result === "W" ? "Won" : r.result === "L" ? "Lost" : "Tied"}>{r.result}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <Link to={r.href} className="font-medium text-foreground hover:text-accent-text hover:underline">{r.label}</Link>
            <span className="tabular-nums"><b className={r.alliance === "red" ? "text-red-alliance-text" : "text-blue-alliance-text"}>{r.ownNp ?? r.own}</b>{r.ownNp != null && r.ownNp !== r.own && <span className="text-[11px] text-muted-foreground"> ({r.own} with penalties)</span>}<span className="text-muted-foreground"> – {r.opp}</span></span>
          </p>
          <p className="truncate text-xs text-muted-foreground"><Link to={r.event.href} className="hover:text-accent-text hover:underline">{r.event.label}</Link> · {r.season}{r.date ? ` · ${r.date}` : ""}</p>
          {!!(r.partners?.length || r.opponents?.length) && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {r.partners?.length ? <>With {r.partners.map((p, i) => <span key={p.href}>{i > 0 && ", "}<Link to={p.href} className="hover:text-accent-text hover:underline">{p.label}</Link></span>)}</> : null}
              {r.opponents?.length ? <>{r.partners?.length ? " · " : ""}vs {r.opponents.map((p, i) => <span key={p.href}>{i > 0 && ", "}<Link to={p.href} className="hover:text-accent-text hover:underline">{p.label}</Link></span>)}</> : null}
            </p>
          )}
        </div>
      </div>
    </li>
  );
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
          {pts.length > 1 && <polyline points={pts.map((p) => `${x(p.i)},${y(p.y)}`).join(" ")} fill="none" className="stroke-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        </svg>
        {pts.map((p) => {
          const dot = <span className="block size-3 rounded-full border-2 border-accent bg-card" />;
          const style = { left: `${x(p.i)}%`, top: `${y(p.y)}%` };
          const label = `${p.x}: ${p.y}${b.unit ? ` ${b.unit}` : ""}${p.note ? ` (${p.note})` : ""}`;
          return p.href
            ? <Link key={p.i} to={p.href} style={style} title={label} aria-label={label} className="absolute -translate-x-1/2 -translate-y-1/2 p-1 hover:[&>span]:bg-accent">{dot}</Link>
            : <span key={p.i} style={style} title={label} aria-label={label} role="img" className="absolute -translate-x-1/2 -translate-y-1/2 p-1">{dot}</span>;
        })}
      </div>
      <p className="mt-1 flex justify-between gap-2 text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        <span className="truncate">{b.points[0].x}</span>{b.points.length > 1 && <span className="truncate text-right">{b.points[b.points.length - 1].x}</span>}
      </p>
      <p className="text-[11px] text-muted-foreground">{rangeCaption(lo, hi, pts.length, b.unit)}</p>
      {/* Every point's value in words too: readable without hovering (phones), and by screen readers. */}
      <ol className="mt-1.5 grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2" data-series-values>
        {b.points.map((p, i) => (
          <li key={i} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-border/60 py-0.5">
            {p.href ? <Link to={p.href} className="min-w-0 truncate text-muted-foreground hover:text-accent-text hover:underline">{p.x}</Link> : <span className="min-w-0 truncate text-muted-foreground">{p.x}</span>}
            <span className="shrink-0 tabular-nums text-foreground">{p.y ?? "–"}{p.note ? <span className="text-muted-foreground"> · {p.note}</span> : null}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

const TONE: Record<string, string> = { a: "bg-chart-1", b: "bg-chart-2", c: "bg-chart-3", d: "bg-chart-4" };

function Bars({ b }: { b: Extract<StatBlock, { kind: "bars" }> }) {
  // Scaled to the largest size either way: a negative value (an OPR part can be below zero) is drawn in the danger
  // colour from the left, its sign on the number.
  const max = Math.max(1, ...b.groups.flatMap((g) => g.items.map((i) => Math.abs(i.value ?? 0))));
  return (
    <figure data-block="bars">
      <figcaption className={H3}>{b.title}</figcaption>
      <div className="space-y-2.5">
        {b.groups.map((g) => (
          <div key={g.label}>
            {b.groups.length > 1 && <p className="mb-1 truncate text-xs font-medium text-foreground">{g.label}</p>}
            <ul className="space-y-1">
              {g.items.map((i) => (
                <li key={i.label} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{i.label}</span>
                  <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", (i.value ?? 0) < 0 ? "bg-danger/70" : TONE[i.tone ?? "a"])} style={{ width: `${(Math.abs(i.value ?? 0) / max) * 100}%` }} /></span>
                  <span className="text-right tabular-nums text-foreground">{i.value == null ? "–" : `${Number.isInteger(i.value) ? i.value : i.value.toFixed(1)}${b.unit === "%" ? "%" : ""}`}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** A leaderboard: the asked stat's teams as the search's one team table (../TeamTable.tsx), sorted by the stat asked
 *  (the list's own order when it isn't an OPR), with its note above and the small "View more detail" link under it. */
function Leaderboard({ b }: { b: Extract<StatBlock, { kind: "leaderboard" }> }) {
  const table = useMemo(() => teamTableOfLeaderboard(b.stat.id, b.stat.label, b.rows, b.teleopWithEndgame), [b]);
  return (
    <figure data-block="leaderboard">
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className={H3}>{b.title}</span>
        <span className="text-[11px] text-muted-foreground" data-note>{b.note}</span>
      </figcaption>
      <TeamTable table={table} label={b.title} />
      {b.more && <p className="mt-2"><Link to={b.more.href} className="inline-flex items-center gap-1 text-xs font-medium text-accent-text hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]" data-more-detail>{b.more.label}<ArrowRight className="size-3.5" aria-hidden /></Link></p>}
    </figure>
  );
}
