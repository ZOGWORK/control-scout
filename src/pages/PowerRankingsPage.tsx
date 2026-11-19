// /power-rankings (the latest week, with the archive) and /power-rankings/:week (one week).
// A weekly top 25: hand-written (content/power-rankings/*.md) or published automatically every Friday
// with blurbs by Bruno, Control Point's AI (docs/power-rankings.md), each team with its rating,
// OPR and record (an automatic week's frozen with its text; a hand-written week's live) and its move since the previous week.
// Blurbs and the intro arrive as sanitized HTML from the server (server/powerRankings/markdown.ts).
import type { MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FlaskConical, ListOrdered, Minus, Share2, Sparkles, Trophy } from "lucide-react";
import { useApi, type ApiError } from "../lib/api";
import { useTitle } from "../lib/meta";
import { copyLink } from "../lib/clipboard";
import { num, seasonLabel } from "../lib/format";
import { EmptyState, Page, PageHeader, Section } from "../components/page";
import { Async, FeatureOffState } from "../components/states";
import { OfflineNote } from "../components/OfflineNote";
import { useFlag } from "../lib/flags";
import { NotFoundView } from "../components/NotFoundView";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import { useIsV8, V8_NUM } from "../lib/v8";
import { RankingsTabs, V8_CAPTION, V8_DOWN, V8_EYEBROW, V8_HEAD, V8_ICON, V8_LINK, V8_NOTE, V8_UP, v8Medal } from "../components/rankings/v8";
import {
  generatedNote, isWeekId, publishedLine, statsLine, weekLabel,
  type Movement, type PowerRankingsEntry, type PowerRankingsResponse, type PowerRankingsSummary, type PowerRankingsWeek,
} from "../shared/powerRankings";

/** Styles for the authors' markdown (paragraphs, emphasis, links, lists). */
const PROSE = "prose-links [&_p+p]:mt-2 [&_a]:text-accent-text [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_code]:rounded [&_code]:bg-text-base/[0.06] [&_code]:px-1 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3";

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
  if (m.kind === "new") return <span className="inline-flex items-center rounded-md border border-accent/30 bg-accent/15 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-accent-text v8:rounded-full v8:border-white/[0.12] v8:bg-transparent v8:text-[0.6875rem] v8:font-medium v8:text-text-muted" aria-label={`New to the top 25${since}`}>New</span>;
  if (m.kind === "same") return <span className="inline-flex items-center text-text-muted" aria-label={`Same place${since}`} title={`Same place${since}`}><Minus className="size-3.5" aria-hidden /></span>;
  const up = m.kind === "up";
  const Icon = up ? ArrowUp : ArrowDown;
  const label = `${up ? "Up" : "Down"} ${m.by} ${m.by === 1 ? "place" : "places"}${since}`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums v8:font-medium", up ? cn("text-success", V8_UP) : cn("text-danger", V8_DOWN))} aria-label={label} title={label}>
      <Icon className="size-3.5" aria-hidden />{m.by}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted v8:text-xs v8:font-normal v8:normal-case v8:tracking-normal v8:text-text-faint">{label}</dt>
      <dd className="font-display text-sm font-semibold tabular-nums text-foreground v8:font-sans v8:font-medium">{value}{hint && <span className={cn("ml-1 font-sans text-xs font-normal text-text-muted", V8_CAPTION)}>{hint}</span>}</dd>
    </div>
  );
}

function Entry({ e, comparedWith, onLink, tagTemplate }: { e: PowerRankingsEntry; comparedWith: string | null; onLink: (ev: MouseEvent<HTMLElement>) => void; tagTemplate: boolean }) {
  const s = e.stats;
  return (
    // v8: a list on hairlines, not a stack of cards; #1's number is the slate blue, the rest white.
    <li className="flex gap-3 rounded-2xl border border-line bg-elevated/60 p-4 sm:gap-5 sm:p-5 v8:rounded-none v8:border-0 v8:border-b v8:bg-transparent v8:px-0 v8:py-5 v8:sm:px-0">
      <div className="flex w-9 shrink-0 flex-col items-center gap-1 pt-0.5 sm:w-11">
        <span className={cn("font-display text-2xl font-semibold leading-none tabular-nums sm:text-[1.75rem]", e.rank <= 3 ? "text-accent-text" : "text-foreground", v8Medal(e.rank))} data-rank>{e.rank}</span>
        <MovementBadge m={e.movement} comparedWith={comparedWith} />
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold leading-snug text-foreground">
          <Link to={`/teams/${e.team}`} className="rounded-sm hover:underline hover:underline-offset-2">
            <span className={cn("tabular-nums", V8_NUM)}>{e.team}</span>{e.name && <span className="text-text-muted"> · </span>}{e.name}
          </Link>
        </h2>
        {e.place && <p className={cn("mt-0.5 text-xs text-text-muted", V8_CAPTION)}>{e.place}</p>}
        <div className={cn("mt-2 text-sm leading-relaxed text-text-base/90", PROSE)} onClick={onLink} dangerouslySetInnerHTML={{ __html: e.blurbHtml }} />
        {tagTemplate && e.author === "template" && <p className={cn("mt-1 text-[11px] font-medium text-text-muted v8:text-[0.6875rem]", V8_CAPTION)}>Data summary</p>}
        {s ? (
          <dl className="mt-3 grid grid-cols-3 gap-3 border-t border-line pt-3 sm:flex sm:gap-8 v8:border-0 v8:pt-0">
            <Stat label="Rating" value={num(s.rating)} hint={s.ratingRank ? `#${s.ratingRank.toLocaleString()}` : null} />
            <Stat label="OPR" value={num(s.opr)} />
            <Stat label="Record" value={`${s.wins}-${s.losses}-${s.ties}`} />
          </dl>
        ) : <p className={cn("mt-3 border-t border-line pt-3 text-xs text-text-muted v8:border-0 v8:pt-0", V8_CAPTION)}>No matches this season yet.</p>}
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
      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line v8:rounded-none v8:border-0 v8:border-y">
        {archive.map((a) => (
          <li key={a.week}>
            <Link to={`/power-rankings/${a.week}`} aria-current={a.week === current ? "page" : undefined}
              className={cn("flex min-h-14 flex-col justify-center gap-0.5 px-4 py-3 hover:bg-text-base/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-4", "v8:min-h-11 v8:px-0 v8:py-2 v8:transition-colors v8:duration-150 v8:hover:bg-white/[0.03]", a.week === current && "bg-accent/[0.07] v8:bg-white/[0.05] v8:shadow-[inset_2px_0_0_var(--color-accent)] v8:pl-3")}>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{a.title}</span>
                <span className={cn("block text-xs text-text-muted", V8_CAPTION)}>{weekLabel(a.week)} · {seasonLabel(a.season)}</span>
              </span>
              <span className="truncate text-xs text-text-muted">{a.top.map((t, i) => `${i + 1}. ${t.team}${t.name ? ` ${t.name}` : ""}`).join("  ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Control Point's landing page, linked wherever the note names it. */
const CONTROL_POINT_HOME = "https://tryctrlpoint.org";

function GeneratedNote({ text }: { text: string }) {
  const at = text.indexOf("Control Point");
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={CONTROL_POINT_HOME} target="_blank" rel="noreferrer noopener" className="font-medium text-accent-text underline underline-offset-2 hover:no-underline v8:font-normal">Control Point</a>
      {text.slice(at + "Control Point".length)}
    </>
  );
}

function Week({ w, archive, onLink }: { w: PowerRankingsWeek; archive: PowerRankingsSummary[]; onLink: (ev: MouseEvent<HTMLElement>) => void }) {
  const v8 = useIsV8();
  return (
    <div className={V8_HEAD}>
      <PageHeader
        eyebrow={<span className={V8_EYEBROW}>{weekLabel(w.week)} · {seasonLabel(w.season)}</span>}
        title={w.title}
        description={`${publishedLine(w)}${w.comparedWith ? `. Moves are since week ${Number(w.comparedWith.slice(6))}.` : "."} ${statsLine(w)}`}
        actions={<Button variant={v8 ? "outline" : "secondary"} onClick={() => void share(w)}><Share2 /> Share</Button>}
      >{v8 ? <RankingsTabs at="power" season={w.season} /> : null}</PageHeader>
      {w.sample && (
        <div role="note" className={cn("-mt-4 mb-6 max-sm:mb-4 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-accent-text", V8_NOTE)}>
          <FlaskConical className={cn("mt-0.5 size-4 shrink-0", V8_ICON)} aria-hidden />
          <p><strong>Sample week.</strong> Development content to preview this page, not real rankings. It's never shown on the live site.</p>
        </div>
      )}
      {w.generated && (
        <p role="note" className={cn("-mt-4 mb-6 max-sm:mb-4 flex max-w-3xl items-start gap-2 rounded-xl border border-accent/30 bg-accent/[0.07] px-3 py-2 text-sm text-text-base/90", "v8:mt-0 v8:rounded-none v8:border-0 v8:bg-transparent v8:p-0 v8:text-xs v8:text-text-faint")}>
          <Sparkles className={cn("mt-0.5 size-4 shrink-0 text-accent-text", V8_ICON, "v8:size-3.5 v8:mt-px")} aria-hidden />
          <span><GeneratedNote text={generatedNote(w.generated)} /></span>
        </p>
      )}
      <div className={cn("mb-8 max-sm:mb-5 max-w-3xl text-[0.9375rem] leading-relaxed text-text-base/90", PROSE)} onClick={onLink} dangerouslySetInnerHTML={{ __html: w.introHtml }} />
      <ol className="mb-6 max-sm:mb-4 grid gap-3 v8:gap-0 v8:border-t v8:border-line" aria-label={`${w.title}: the top ${w.entries.length}`}>
        {w.entries.map((e) => <Entry key={e.team} e={e} comparedWith={w.comparedWith} onLink={onLink} tagTemplate={!!w.generated && w.generated.bruno > 0} />)}
      </ol>
      {w.droppedOut.length > 0 && (
        <p className="mb-6 max-sm:mb-4 text-sm text-text-muted">
          <span className="font-medium text-foreground v8:font-normal v8:text-text-faint">Dropped out: </span>
          {w.droppedOut.map((d, i) => (
            <span key={d.team}>{i > 0 && ", "}<Link to={`/teams/${d.team}`} className="underline underline-offset-2">{d.team}{d.name ? ` ${d.name}` : ""}</Link> (was {d.lastRank})</span>
          ))}
        </p>
      )}
      <nav aria-label="Other weeks" className="mb-10 max-sm:mb-6 flex flex-wrap items-center gap-2">
        {w.previous && <Button variant={v8 ? "outline" : "secondary"} asChild><Link to={`/power-rankings/${w.previous}`}><ArrowLeft /> Week {Number(w.previous.slice(6))}</Link></Button>}
        {w.next && <Button variant={v8 ? "outline" : "secondary"} asChild><Link to={`/power-rankings/${w.next}`}>Week {Number(w.next.slice(6))} <ArrowRight /></Link></Button>}
        <Button variant="ghost" asChild className={V8_LINK}><Link to={w.worldRankings}><ListOrdered /> Every team in the world rankings</Link></Button>
      </nav>
      <Archive archive={archive} current={w.week} />
    </div>
  );
}

export default function PowerRankingsPage() {
  const { week } = useParams();
  const id = week?.toLowerCase() ?? null;
  const valid = id === null || isWeekId(id);
  // Switched off by the owner (the powerRankings feature toggle): nothing asked for, the page says so (a deep link too).
  const on = useFlag("powerRankings");
  const state = useApi<PowerRankingsResponse>(valid && on ? (id ? `/api/power-rankings/${id}` : "/api/power-rankings") : null);
  const onLink = useInAppLinks();
  const w = state.data?.week ?? null;
  useTitle(!valid || (state.error as ApiError | undefined)?.status === 404 ? "Page not found" : w ? (id ? `${w.title} (${seasonLabel(w.season)})` : "FTC power rankings") : "FTC power rankings");

  if (!on) {
    return (
      <Page>
        <div className={V8_HEAD}><PageHeader title="FTC power rankings" description="A weekly top 25 of FTC teams, each with a short written take and the team's live numbers."><RankingsTabs at="power" /></PageHeader></div>
        <FeatureOffState feature="powerRankings" />
      </Page>
    );
  }
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
            <div className={V8_HEAD}><PageHeader title="FTC power rankings" description="A weekly top 25 of FTC teams, each with a short written take and the team's live numbers."><RankingsTabs at="power" /></PageHeader></div>
            <EmptyState icon={Trophy} title="No power rankings published yet"
              description="The first weekly top 25 will be published here during the season. Until then, the world rankings list every rated team by its prediction rating."
              action={<Button variant="secondary" asChild><Link to="/rankings"><ListOrdered /> World rankings</Link></Button>} />
          </>
        )}
      >
        {(d) => <><OfflineNote data={d} what="Power rankings" /><Week w={d.week!} archive={d.archive} onLink={onLink} /></>}
      </Async>
    </Page>
  );
}
