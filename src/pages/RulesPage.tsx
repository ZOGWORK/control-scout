// /rules: the question-box quick reference. The season's most-cited game rules and its published Q&A rulings,
// summarised (src/shared/rules), with a search that runs in the browser over the copy built into the app, so it
// answers with no signal at the venue. A section browser jumps through the manual's order; every rule has its
// own link (/rules#G421). The revision stamp and the "unofficial, check the manual" note are always on screen.
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AlertTriangle, BookOpen, ExternalLink, FileCheck2, MessagesSquare, Search, WifiOff, X } from "lucide-react";
import { useTitle } from "../lib/meta";
import { PageHeader } from "../components/page";
import { FeatureOffState } from "../components/states";
import { useFlag } from "../lib/flags";
import { Badge, Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import { scrollToElement } from "../lib/pageScroll";
import { hasRuleReference, ruleReference, rulingsFor, searchRules, stampDate, type QaRuling, type RuleEntry, type SeasonReference } from "../shared/rules";

/** Each part of the manual's colour (badges, the section browser). */
const PART_TONE: Record<string, string> = {
  Eligibility: "text-sky-500 bg-sky-500/15",
  Game: "text-emerald-500 bg-emerald-500/15",
  "Game rules": "text-orange-500 bg-orange-500/15",
  Robot: "text-violet-500 bg-violet-500/15",
  Tournament: "text-rose-500 bg-rose-500/15",
};
const partTone = (part: string | undefined) => PART_TONE[part ?? ""] ?? "text-muted-foreground bg-muted";

/** What a rule costs, coloured by how much: red card, major/yellow, minor, points scored, or anything else. */
function penaltyTone(entry: RuleEntry): string {
  const p = (entry.penalty ?? "").toLowerCase();
  if (entry.section.startsWith("10.5")) return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (p.includes("red card") || p.includes("disqualified")) return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
  if (p.includes("major") || p.includes("yellow")) return "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400";
  if (p.includes("minor")) return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-border bg-text-base/[0.04] text-muted-foreground";
}

/** The anchor for a rule or a ruling. */
const ruleAnchor = (id: string) => id;
const qaAnchor = (n: number) => `qa-${n}`;
/** Follows a link to another entry on the page (RulesPage.follow). */
type Follow = (id: string) => (e: MouseEvent) => void;

function RuleCard({ entry, sectionLabel, tone, rulings, flash, follow }: { entry: RuleEntry; sectionLabel?: string; tone: string; rulings: QaRuling[]; flash: boolean; follow: Follow }) {
  return (
    <li id={ruleAnchor(entry.id)} className={cn("scroll-mt-bar-20 px-5 py-4 max-sm:px-4", flash && "bg-accent/[0.08]")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-md px-2 py-0.5 font-mono text-xs font-semibold", tone)}>{entry.id.replace(/-.*$/, "")}</span>
        <h3 className="font-medium text-foreground">{entry.title}</h3>
      </div>
      {sectionLabel && <p className="mt-1 text-xs text-muted-foreground">{sectionLabel}</p>}
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{entry.summary}</p>
      {entry.penalty && (
        <p className={cn("mt-2.5 inline-flex rounded-lg border px-2.5 py-1 text-xs font-medium", penaltyTone(entry))}>
          {entry.section.startsWith("10.5") ? "Worth: " : "Penalty: "}{entry.penalty}
        </p>
      )}
      {rulings.length > 0 && (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <MessagesSquare className="size-3.5" aria-hidden /> Q&A on this rule:
          {rulings.map((q) => <a key={q.n} href={`#${qaAnchor(q.n)}`} onClick={follow(qaAnchor(q.n))} className="rounded-md bg-info/10 px-1.5 py-0.5 font-medium text-info hover:bg-info/20">Q{q.n}</a>)}
        </p>
      )}
    </li>
  );
}

function RulingCard({ q, ruleIds, flash, follow }: { q: QaRuling; ruleIds: Set<string>; flash: boolean; follow: Follow }) {
  return (
    <li id={qaAnchor(q.n)} className={cn("scroll-mt-bar-20 px-5 py-4 max-sm:px-4", flash && "bg-accent/[0.08]")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-info/15 px-2 py-0.5 font-mono text-xs font-semibold text-info">Q{q.n}</span>
        <h3 className="font-medium text-foreground">{q.title}</h3>
      </div>
      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <Badge variant="info">Unofficial guidance</Badge>
        <span>Answered {stampDate(q.answered)}</span>
        {q.rules.map((r) => ruleIds.has(r)
          ? <a key={r} href={`#${ruleAnchor(r)}`} onClick={follow(ruleAnchor(r))} className="font-mono font-medium text-accent-text hover:underline">{r}</a>
          : <span key={r} className="font-mono">{r}</span>)}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{q.summary}</p>
    </li>
  );
}

/** The revision stamp and the note: what this follows, and that it isn't the official text. */
function Stamp({ data: r }: { data: SeasonReference }) {
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 max-sm:p-4" data-rules-stamp>
        <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 size-40 rounded-full bg-accent opacity-15 blur-3xl" />
        <p className="relative flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"><FileCheck2 className="size-4 text-accent" aria-hidden /> Follows the manual</p>
        <p className="relative mt-1.5 font-display text-3xl font-semibold tracking-tight text-foreground">{r.manual.revision}</p>
        <p className="relative text-sm text-muted-foreground">{r.game} Competition Manual, {stampDate(r.manual.date)}</p>
        <div className="relative mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span><span className="font-semibold tabular-nums text-orange-500">{r.rules.length}</span> <span className="text-muted-foreground">rules</span></span>
          <span><span className="font-semibold tabular-nums text-info">{r.rulings.length}</span> <span className="text-muted-foreground">Q&A rulings (read {stampDate(r.qa.readOn)})</span></span>
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><WifiOff className="size-3.5" aria-hidden /> Works offline</span>
        </div>
      </div>
      <div className="rounded-2xl border border-amber-500/35 bg-amber-500/[0.08] p-5 max-sm:p-4" role="note" data-rules-note>
        <p className="flex items-center gap-2 font-medium text-foreground"><AlertTriangle className="size-4 text-amber-500" aria-hidden /> Unofficial summaries: check the official manual</p>
        <p className="mt-1.5 text-sm text-muted-foreground">These are short summaries in our own words, not FIRST's text, and they leave out detail and exceptions. Before you go to the question box, read the rule itself in the manual. The head referee's call is final.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" asChild><a href={r.manual.url} target="_blank" rel="noreferrer noopener"><BookOpen /> Official manual <ExternalLink /></a></Button>
          <Button size="sm" variant="secondary" asChild><a href={r.qa.url} target="_blank" rel="noreferrer noopener"><MessagesSquare /> Official Q&A <ExternalLink /></a></Button>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ id, children, tone }: { id: string; children: ReactNode; tone: string }) {
  return (
    <h2 id={id} className="mb-3 flex scroll-mt-bar-20 items-center gap-2.5 font-display text-lg font-semibold">
      <span className={cn("size-2.5 rounded-full bg-current", tone)} aria-hidden />{children}
    </h2>
  );
}

export default function RulesPage() {
  const [sp] = useSearchParams();
  const season = Number(sp.get("season")) || null;
  const ref = ruleReference(season);
  const missing = season != null && !hasRuleReference(season);
  useTitle("Rules");
  const { hash } = useLocation();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const sectionOf = useMemo(() => new Map(ref.sections.map((s) => [s.id, s])), [ref]);
  const ruleIds = useMemo(() => new Set(ref.rules.map((r) => r.id)), [ref]);
  const found = useMemo(() => searchRules(ref, query), [ref, query]);
  const searching = query.trim().length > 0;
  const shown = found.rules.length + found.rulings.length;
  // Browsing: the manual's order, one group per section that has entries.
  const grouped = useMemo(() => ref.sections.map((s) => ({ s, items: ref.rules.filter((r) => r.section === s.id) })).filter((g) => g.items.length), [ref]);
  const parts = useMemo(() => [...new Set(grouped.map((g) => g.s.part))], [grouped]);

  // Going to a rule or ruling (/rules#G421, a Q&A chip, a rule number on a ruling) brings it into view and marks it
  // briefly. One the search has hidden clears the search first, then is shown once the full list is back.
  const [target, setTarget] = useState<{ id: string } | null>(null);
  const go = (id: string) => { if (!document.getElementById(id)) setQuery(""); setTarget({ id }); };
  useEffect(() => {
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    if (id) go(id);
  }, [hash]);
  useEffect(() => {
    if (!target) return;
    const el = document.getElementById(target.id);
    if (!el) return; // waiting for the search to clear (or not an entry at all)
    requestAnimationFrame(() => scrollToElement(el));
    setFlash(target.id);
    const t = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(t);
  }, [target, query]);
  /** A link to an entry on this page: kept as a real #link, followed here so a hidden one is revealed. */
  const follow = (id: string) => (e: MouseEvent) => { e.preventDefault(); history.replaceState(history.state, "", `#${id}`); go(id); };

  const jump = (id: string) => { const el = document.getElementById(id); if (el) scrollToElement(el); };
  // Switched off by the owner (the rulesReference feature toggle): the page says so, a deep link too.
  if (!useFlag("rulesReference")) return (
    <div>
      <PageHeader title="Rules quick reference" />
      <FeatureOffState feature="rulesReference" />
    </div>
  );
  const sectionLabel = (r: RuleEntry) => { const s = sectionOf.get(r.section); return s ? `${s.id} ${s.title}` : r.section; };

  return (
    <div>
      <PageHeader eyebrow={`${ref.game} · ${ref.label}`} title="Rules quick reference"
        description="The most-cited game rules and the season's Q&A rulings, in short, for drivers on their way to the question box. Search works with no signal."
        phoneDescription={`${ref.game} rules and Q&A rulings, offline.`} />

      {missing && <p className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">No quick reference for that season yet: this is {ref.game} ({ref.label}).</p>}
      <Stamp data={ref} />

      <div className="mt-6 max-sm:mt-4 relative max-w-xl">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search"
          placeholder="Search rules, e.g. pin, G407, NECTAR, question box" aria-label="Search the rules" className="h-12 rounded-xl pl-10 pr-10 text-base" />
        {searching && (
          <button type="button" onClick={() => { setQuery(""); search.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">{searching ? `${shown} ${shown === 1 ? "match" : "matches"}: ${found.rules.length} ${found.rules.length === 1 ? "rule" : "rules"}, ${found.rulings.length} Q&A` : " "}</p>

      <div className="mt-4 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* The section browser: a sticky list beside the rules on wide screens, a jump menu on phones. */}
        <nav aria-label="Manual sections" className={cn(searching && "max-lg:hidden")} data-rules-sections>
          <label className="lg:hidden">
            <span className="sr-only">Jump to a section</span>
            <select className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm" value="" onChange={(e) => { if (e.target.value) { setQuery(""); requestAnimationFrame(() => jump(e.target.value)); } }}>
              <option value="">Jump to a section…</option>
              {parts.map((p) => (
                <optgroup key={p} label={p}>
                  {grouped.filter((g) => g.s.part === p).map((g) => <option key={g.s.id} value={`section-${g.s.id}`}>{g.s.id} {g.s.title}</option>)}
                </optgroup>
              ))}
              {ref.rulings.length > 0 && <option value="qa">Q&A rulings</option>}
            </select>
          </label>
          <div className="sticky top-[calc(var(--header-h)+1rem)] max-h-[calc(100dvh-var(--header-h)-2rem)] overflow-y-auto overscroll-contain max-lg:hidden">
            {parts.map((p) => (
              <div key={p} className="mb-4">
                <p className={cn("mb-1 inline-flex rounded-md px-2 py-0.5 text-xs font-semibold", partTone(p))}>{p}</p>
                <ul>
                  {grouped.filter((g) => g.s.part === p).map((g) => (
                    <li key={g.s.id}>
                      <a href={`#section-${g.s.id}`} onClick={(e) => { e.preventDefault(); setQuery(""); requestAnimationFrame(() => jump(`section-${g.s.id}`)); }}
                        className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm text-muted-foreground hover:bg-text-base/[0.05] hover:text-foreground">
                        <span className="w-11 shrink-0 font-mono text-xs">{g.s.id}</span><span className="truncate">{g.s.title}</span>
                        <span className="ml-auto text-xs tabular-nums">{g.items.length}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <a href="#qa" onClick={(e) => { e.preventDefault(); setQuery(""); requestAnimationFrame(() => jump("qa")); }}
              className="flex min-h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium text-info hover:bg-info/10">
              <MessagesSquare className="size-4" aria-hidden /> Q&A rulings <span className="ml-auto text-xs tabular-nums">{ref.rulings.length}</span>
            </a>
          </div>
        </nav>

        <div className="min-w-0 space-y-8 max-sm:space-y-6">
          {searching ? (
            shown === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center max-sm:px-4 max-sm:py-6">
                <p className="font-medium">Nothing matches “{query.trim()}”</p>
                <p className="mt-1 text-sm text-muted-foreground">This covers the most-cited rules only. Try another word, or search the official manual.</p>
                <Button className="mt-4" asChild><a href={ref.manual.htmlUrl} target="_blank" rel="noreferrer noopener"><BookOpen /> Open the manual <ExternalLink /></a></Button>
              </div>
            ) : (
              <>
                {found.rules.length > 0 && (
                  <section aria-label="Matching rules">
                    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                      {found.rules.map((r) => <RuleCard key={r.id} entry={r} sectionLabel={sectionLabel(r)} tone={partTone(sectionOf.get(r.section)?.part)} rulings={rulingsFor(ref, r.id)} flash={flash === r.id} follow={follow} />)}
                    </ul>
                  </section>
                )}
                {found.rulings.length > 0 && (
                  <section aria-labelledby="qa">
                    <SectionHeading id="qa" tone="text-info">Q&A rulings</SectionHeading>
                    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                      {found.rulings.map((q) => <RulingCard key={q.n} q={q} ruleIds={ruleIds} flash={flash === qaAnchor(q.n)} follow={follow} />)}
                    </ul>
                  </section>
                )}
              </>
            )
          ) : (
            <>
              {grouped.map((g) => (
                <section key={g.s.id} aria-labelledby={`section-${g.s.id}`}>
                  <SectionHeading id={`section-${g.s.id}`} tone={partTone(g.s.part).split(" ")[0]}><span className="font-mono text-base text-muted-foreground">{g.s.id}</span>{g.s.title}</SectionHeading>
                  <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                    {g.items.map((r) => <RuleCard key={r.id} entry={r} tone={partTone(g.s.part)} rulings={rulingsFor(ref, r.id)} flash={flash === r.id} follow={follow} />)}
                  </ul>
                </section>
              ))}
              <section aria-labelledby="qa">
                <SectionHeading id="qa" tone="text-info">Q&A rulings</SectionHeading>
                <p className="mb-3 text-sm text-muted-foreground">Answers FIRST has published on its Q&A board, summarised. Each is unofficial guidance here: read the full answer on the <a href={ref.qa.url} target="_blank" rel="noreferrer noopener" className="font-medium text-accent-text underline-offset-4 hover:underline">official Q&A</a>.</p>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
                  {ref.rulings.map((q) => <RulingCard key={q.n} q={q} ruleIds={ruleIds} flash={flash === qaAnchor(q.n)} follow={follow} />)}
                </ul>
              </section>
            </>
          )}
          <p className="text-xs text-muted-foreground">Not affiliated with FIRST. Summaries follow the {ref.game} Competition Manual {ref.manual.revision} ({stampDate(ref.manual.date)}); a newer Team Update may change a rule before this page catches up. See also the <Link to="/faq#offline" className="underline-offset-4 hover:underline">offline FAQ</Link>.</p>
        </div>
      </div>
    </div>
  );
}
