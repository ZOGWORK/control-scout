// /power-rankings (the latest week, with the archive) and /power-rankings/:week (one week).
// A weekly top 25 written by people (content/power-rankings/*.md, docs/power-rankings.md),
// each team with its live rating, OPR and record and its move since the previous week.
// Blurbs and the intro arrive as sanitized HTML from the server (server/powerRankings/markdown.ts).
import type { MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FlaskConical, ListOrdered, Minus, Share2, Trophy } from "lucide-react";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { copyLink } from "../lib/clipboard";
import { num, seasonLabel } from "../lib/format";
import { EmptyState, Page, PageHeader, Section } from "../components/page";
import { Async } from "../components/states";
import { NotFoundView } from "../components/NotFoundView";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import {
  isWeekId, longDate, weekLabel,
  type Movement, type PowerRankingsEntry, type PowerRankingsResponse, type PowerRankingsSummary, type PowerRankingsWeek,
} from "../shared/powerRankings";

/** Styles for the authors' markdown (paragraphs, emphasis, links, lists). */
const PROSE = "[&_p+p]:mt-2 [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-text-base/[0.06] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3";

/** Links inside the authors' HTML that point at this site open in the app, not with a full reload. */
function useInAppLinks() {
  const navigate = useNavigate();
  return (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target === "_blank" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith("/") || href.startsWith("//")) return;
    e.preventDefault();
    navigate(href);
  };
}

function MovementBadge({ m, comparedWith }: { m: Movement | null; comparedWith: string | null }) {
  if (!m) return null;
  const since = comparedWith ? ` since week ${Number(comparedWith.slice(6))}` : "";
  if (m.kind === "new") return <span className="inline-flex items-center rounded-md border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent-text" aria-label={`New to the top 25${since}`}>New</span>;
  if (m.kind === "same") return <span className="inline-flex items-center text-text-muted" aria-label={`Same place${since}`} title={`Same place${since}`}><Minus className="size-3.5" aria-hidden /></span>;
  const up = m.kind === "up";
  const Icon = up ? ArrowUp : ArrowDown;
  const label = `${up ? "Up" : "Down"} ${m.by} ${m.by === 1 ? "place" : "places"}${since}`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")} aria-label={label} title={label}>
      <Icon className="size-3.5" aria-hidden />{m.by}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">{label}</dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-foreground">{value}{hint && <span className="ml-1 font-sans text-xs font-normal text-text-muted">{hint}</span>}</dd>
    </div>
  );
}

function Entry({ e, comparedWith, onLink }: { e: PowerRankingsEntry; comparedWith: string | null; onLink: (ev: MouseEvent<HTMLElement>) => void }) {
  const s = e.stats;
  return (
    <li className="flex gap-3 rounded-2xl border border-line bg-elevated/60 p-4 sm:gap-5 sm:p-5">
      <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-0.5 sm:w-11">
        <span className={cn("font-display text-2xl font-semibold leading-none tabular-nums sm:text-[28px]", e.rank <= 3 ? "text-accent-text" : "text-foreground")}>{e.rank}</span>
        <MovementBadge m={e.movement} comparedWith={comparedWith} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          <Link to={`/teams/${e.team}`} className="rounded-sm hover:underline hover:underline-offset-2">
            <span className="tabular-nums">{e.team}</span>{e.name && <span className="text-text-muted"> · </span>}{e.name}
          </Link>
        </h2>
        {e.place && <p className="mt-0.5 text-xs text-text-muted">{e.place}</p>}
        <div className={cn("mt-2 text-sm leading-relaxed text-text-base/90", PROSE)} onClick={onLink} dangerouslySetInnerHTML={{ __html: e.blurbHtml }} />
        {s ? (
          <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 sm:flex sm:gap-8">
            <Stat label="Rating" value={num(s.rating)} hint={s.ratingRank ? `#${s.ratingRank.toLocaleString()}` : null} />
            <Stat label="OPR" value={num(s.opr)} />
            <Stat label="Record" value={`${s.wins}-${s.losses}-${s.ties}`} />
          </dl>
        ) : <p className="mt-3 border-t border-line pt-3 text-xs text-text-muted">No matches this season yet.</p>}
      </div>
    </li>
  );
}

async function share(w: PowerRankingsWeek) {
  const url = `${location.origin}/power-rankings/${w.week}`;
  const top = w.entries.slice(0, 3).map((e) => `#${e.rank} ${e.team}${e.name ? ` ${e.name}` : ""}`).join(", ");
  if (navigator.share) {
    try { await navigator.share({ title: w.title, text: `${w.title}: ${top}`, url }); return; } catch (err) { if ((err as Error)?.name === "AbortError") return; }
  }
  await copyLink(url);
}

function Archive({ archive, current }: { archive: PowerRankingsSummary[]; current: string | null }) {
  if (!archive.length) return null;
  return (
    <Section title="All weeks" description="Every published top 25, newest first.">
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
        {archive.map((a) => (
          <li key={a.week}>
            <Link to={`/power-rankings/${a.week}`} aria-current={a.week === current ? "page" : undefined}
              className={cn("flex min-h-14 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-text-base/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-4", a.week === current && "bg-accent/[0.07]")}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{a.title}</span>
                <span className="block text-xs text-text-muted">{weekLabel(a.week)} · {seasonLabel(a.season)}</span>
              </span>
              <span className="truncate text-xs text-text-muted">{a.top.map((t, i) => `${i + 1}. ${t.team}${t.name ? ` ${t.name}` : ""}`).join("  ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Week({ w, archive, onLink }: { w: PowerRankingsWeek; archive: PowerRankingsSummary[]; onLink: (ev: MouseEvent<HTMLElement>) => void }) {
  return (
    <>
      <PageHeader
        eyebrow={`${weekLabel(w.week)} · ${seasonLabel(w.season)}`}
        title={w.title}
        description={`Published ${longDate(w.published)}${w.comparedWith ? `. Moves are since week ${Number(w.comparedWith.slice(6))}.` : "."}`}
        actions={<Button variant="secondary" onClick={() => void share(w)}><Share2 /> Share</Button>}
      />
      {w.sample && (
        <div role="note" className="-mt-4 mb-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p><strong>Sample week.</strong> Development content to preview this page, not real rankings. It's never shown on the live site.</p>
        </div>
      )}
      <div className={cn("mb-8 max-w-3xl text-[15px] leading-relaxed text-text-base/90", PROSE)} onClick={onLink} dangerouslySetInnerHTML={{ __html: w.introHtml }} />
      <ol className="mb-6 grid gap-3" aria-label={`${w.title}: the top ${w.entries.length}`}>
        {w.entries.map((e) => <Entry key={e.team} e={e} comparedWith={w.comparedWith} onLink={onLink} />)}
      </ol>
      {w.droppedOut.length > 0 && (
        <p className="mb-6 text-sm text-text-muted">
          <span className="font-medium text-foreground">Dropped out: </span>
          {w.droppedOut.map((d, i) => (
            <span key={d.team}>{i > 0 && ", "}<Link to={`/teams/${d.team}`} className="underline underline-offset-2">{d.team}{d.name ? ` ${d.name}` : ""}</Link> (was {d.lastRank})</span>
          ))}
        </p>
      )}
      <nav aria-label="Other weeks" className="mb-10 flex flex-wrap items-center gap-2">
        {w.previous && <Button variant="secondary" asChild><Link to={`/power-rankings/${w.previous}`}><ArrowLeft /> Week {Number(w.previous.slice(6))}</Link></Button>}
        {w.next && <Button variant="secondary" asChild><Link to={`/power-rankings/${w.next}`}>Week {Number(w.next.slice(6))} <ArrowRight /></Link></Button>}
        <Button variant="ghost" asChild><Link to={w.worldRankings}><ListOrdered /> Every team in the world rankings</Link></Button>
      </nav>
      <Archive archive={archive} current={w.week} />
    </>
  );
}

export default function PowerRankingsPage() {
  const { week } = useParams();
  const id = week?.toLowerCase() ?? null;
  const valid = id === null || isWeekId(id);
  const state = useApi<PowerRankingsResponse>(valid ? (id ? `/api/power-rankings/${id}` : "/api/power-rankings") : null);
  const onLink = useInAppLinks();
  const w = state.data?.week ?? null;
  useTitle(!valid || (state.error as ApiError | undefined)?.status === 404 ? "Page not found" : w ? (id ? `${w.title} (${seasonLabel(w.season)})` : "FTC power rankings") : "FTC power rankings");

  const missing = !valid || (state.error as ApiError | undefined)?.status === 404;
  if (missing) {
    return (
      <NotFoundView
        title={`There are no power rankings for ${week}`}
        description="Power rankings come out once a week during the season, at addresses like /power-rankings/2026-w42. The latest week and every past one are on the power rankings page."
        action={<Button variant="secondary" asChild><Link to="/power-rankings"><Trophy /> Latest power rankings</Link></Button>}
      />
    );
  }

  return (
    <Page>
      <Async
        state={state}
        empty={(d) => !d.week && (
          <>
            <PageHeader title="FTC power rankings" description="A weekly top 25 of FTC teams, each with a short written take and the team's live numbers." />
            <EmptyState icon={Trophy} title="No power rankings published yet"
              description="The first weekly top 25 will be published here during the season. Until then, the world rankings list every rated team by its prediction rating."
              action={<Button variant="secondary" asChild><Link to="/rankings"><ListOrdered /> World rankings</Link></Button>} />
          </>
        )}
      >
        {(d) => <Week w={d.week!} archive={d.archive} onLink={onLink} />}
      </Async>
    </Page>
  );
}
