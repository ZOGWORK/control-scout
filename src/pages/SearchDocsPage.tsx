// How FTC One Search works: what you can search for and how a query is
// answered, step by step, as the code does it (server/api/searchAnswer.ts).
// A subpage of the How it works hub, built from the prediction page's parts
// (src/components/howitworks/) so the two read and move alike. The words,
// steps and examples are data (src/components/howitworks/searchDocs.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInView } from "motion/react";
import { ArrowUpRight, Pause, Play, Search } from "lucide-react";
import { useTitle } from "../lib/meta";
import { cn } from "../components/cn";
import { m } from "../components/motion";
import "../components/howitworks/howitworks.css";
import { HubCrumb } from "../components/howitworks/HubCrumb";
import { SectionNav } from "../components/howitworks/SectionNav";
import { CleanList, Eyebrow, Figure, Prose, Reveal, SectionHead, Seg, TipLayer, useReduced } from "../components/howitworks/ui";
import { READINGS, SEARCH_FAMILIES, SEARCH_STEPS, type Role } from "../components/howitworks/searchDocs";

const ease = [0.2, 0.8, 0.2, 1] as const;
const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "steps", label: "Steps" },
  { id: "reading", label: "Reading" },
  { id: "answers", label: "Answers" },
  { id: "results", label: "Results" },
  { id: "nothing", label: "No match" },
  { id: "rules", label: "No AI" },
  { id: "limits", label: "Limits" },
] as const;

const ROLE: Record<Role, { label: string; cls: string }> = {
  team: { label: "team", cls: "border-accent bg-accent text-accent-ink" },
  versus: { label: "compare", cls: "border-foreground bg-foreground text-background" },
  stat: { label: "what to find", cls: "border-blue-alliance bg-blue-alliance/15 text-blue-alliance-text" },
  scope: { label: "which events", cls: "border-red-alliance bg-red-alliance/15 text-red-alliance-text" },
  kind: { label: "kind", cls: "border-red-alliance bg-red-alliance/15 text-red-alliance-text" },
  place: { label: "place", cls: "border-success bg-success/15 text-success" },
  time: { label: "time", cls: "border-border bg-muted text-foreground" },
  filler: { label: "skipped", cls: "border-dashed border-border text-muted-foreground line-through" },
};

const WORDS: { w: string; gold?: boolean }[] = [{ w: "How" }, { w: "FTC" }, { w: "One" }, { w: "Search", gold: true }, { w: "works" }];

export default function SearchDocsPage() {
  useTitle("How FTC One Search works");
  const reduced = useReduced();
  return (
    <TipLayer>
      <div className={cn("hiw", !reduced && "hiw-anim")}>
        <HubCrumb here="FTC One Search" />
        <header className="grid items-end gap-8 max-sm:gap-5 pb-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
          <div className="grid min-w-0 gap-5 max-sm:gap-4">
            <Eyebrow>Control Scout · Search, explained</Eyebrow>
            <h1 className="text-balance font-display text-[2.4rem] font-bold leading-[0.98] tracking-tight text-foreground sm:text-6xl xl:text-7xl">
              {WORDS.map(({ w, gold }, i) => (
                <span key={w}>
                  {reduced ? <span className={cn("inline-block", gold && "hiw-gold")}>{w}</span> : (
                    <m.span
                      className={cn("inline-block", gold && "hiw-gold")}
                      initial={{ opacity: 0, y: "0.35em", rotate: 2, filter: "blur(8px)" }}
                      animate={{ opacity: 1, y: 0, rotate: 0, filter: "blur(0px)" }}
                      transition={{ duration: 0.8, ease, delay: 0.12 + i * 0.08 }}
                    >{w}</m.span>
                  )}
                  {i < WORDS.length - 1 && " "}
                </span>
              ))}
            </h1>
            <m.p
              className="max-w-xl text-lg leading-relaxed text-foreground/85 sm:text-xl"
              initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.45 }}
            >
              One box for teams, events, matches, places and questions about them. Here's what you can ask, and exactly how it decides what you meant: by fixed rules, the same way every time.
            </m.p>
            <m.p
              className="font-mono text-xs leading-relaxed text-muted-foreground"
              initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.6 }}
            >
              {SEARCH_STEPS.length} steps, always in the same order · {SEARCH_FAMILIES.length} kinds of answers · no AI in the search path · every example on this page was run on the live site
            </m.p>
          </div>
          <m.div initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.3 }} className="min-w-0">
            <QueryCard />
          </m.div>
        </header>
        <SectionNav sections={SECTIONS} />

        {/* ================= 01 OVERVIEW ================= */}
        <section id="overview" className="scroll-mt-bar-20">
          <SectionHead num="01" eyebrow="The big picture" title="Type it the way you'd say it" />
          <Prose>
            <p>FTC One Search is the search box at the top of every page, and the full results page it opens at <code>/search</code>. It covers <strong>teams</strong> (by number or name), <strong>events</strong> (by name, code, place or date), <strong>matches</strong>, <strong>places</strong>, and questions about them: who won, how many, who's best, a team's records, comparisons, predictions, advancement, awards and rules.</p>
            <p>From the box, pressing Enter on a bare team number (<code>6980</code>, <code>team 6980</code>), one team's exact name or an exact event code goes straight to that page. Anything else opens the results page, where the answer sits on top and the matching teams, events and matches are listed underneath.</p>
          </Prose>
        </section>

        {/* ================= 02 STEPS ================= */}
        <section id="steps" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="02" eyebrow="Step by step" title="Six steps, and the first one that fits answers" />
          <Prose>
            <p>Every query goes through the same steps in the same order. Each step either answers it or passes it on. That's why the same words always give the same result, and why a more specific question (a team, a stat and an event together) is answered before a broad name search gets a go.</p>
          </Prose>
          <StepsFigure />
        </section>

        {/* ================= 03 READING ================= */}
        <section id="reading" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="03" eyebrow="Understanding a query" title="Every word gets a job, or gets skipped" />
          <ReadingFigure />
          <Prose>
            <h3>What it listens for</h3>
            <CleanList items={[
              <><strong>Places.</strong> A US state or Canadian province by its name or two-letter code, and a few Australian ones. Codes that are also English words (OR, IN, ME, HI, OK and others) count only in capitals, so "how many teams in OR" means Oregon while a lowercase "or" stays an ordinary word. In an event search, a state name with a small typo ("upcoming meets in new jesey") is read as the place, and the label says so. After "in", "at", "near" or "from", other words are read as a city or venue ("HS" matches "High School"). Countries work by name, and "USA", "UK" and "England" are understood.</>,
              <><strong>Time.</strong> Today, tomorrow, this or next weekend, week or month, upcoming, past, a month name, a year or a season. "2024" means events held in 2024; "2023-24" means that season. A month belongs to the season it falls in (the season runs September to August). With no time given, events come from the current season, except championships, which cover every season.</>,
              <><strong>Kinds of events.</strong> Meet, qualifier, league, championship, scrimmage and the like, singular or plural. Short forms are understood too: "champs", "cmp", "quals", "worlds", "states".</>,
              <><strong>Comparisons.</strong> "vs", "versus", "v" or "against" between two to four teams opens Compare. "compare A and B", "is A better than B" and two bare team numbers are reworded to the same thing. "who would win A or B" adds the match prediction.</>,
              <><strong>Words it skips.</strong> Small words (in, at, on, the, a, an, for, of, this) never have to match, and question words (how, what, who, is, does…) are dropped when the query reads as a question. A friendly opening ("tell me about", "how good is") is set aside and the rest is searched.</>,
              <><strong>Names.</strong> Matched word by word from the start of each word, ignoring case and accents. A one-letter typo is forgiven in words of four to seven letters, two in longer words; a name typed without spaces still matches.</>,
            ]} />
          </Prose>
        </section>

        {/* ================= 04 ANSWERS ================= */}
        <section id="answers" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="04" eyebrow="What you can ask" title={<>{SEARCH_FAMILIES.length} kinds of answers, each worked out from the records</>} />
          <Prose>
            <p>Each card is a real query. Tap one to run it. Answers are computed from match and event records when you ask, and show their source (the match, event, season or date), so you can check them.</p>
          </Prose>
          <div className="mx-auto my-8 grid max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SEARCH_FAMILIES.map((f, i) => (
              <Reveal key={f.q} delay={(i % 4) * 0.06}>
                <Link to={searchHref(f.q)} className="hiw-panel lift group grid h-full content-start gap-2 rounded-xl border border-border bg-card p-3.5 transition-[transform,border-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:border-accent motion-reduce:hover:translate-y-0">
                  <span className="hiw-gold-text text-[11px] font-bold uppercase tracking-[0.14em]">{f.title}</span>
                  <span className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-2 font-mono text-sm text-foreground">
                    <Search aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 break-words">{f.q}</span>
                    <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                  </span>
                  <span className="text-sm leading-snug text-muted-foreground">{f.what}</span>
                </Link>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= 05 RESULTS ================= */}
        <section id="results" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="05" eyebrow="The results page" title="The answer on top, the matches in groups below" />
          <ResultsFigure />
          <Prose>
            <p>The title names what was understood (for example "Upcoming meets in New Jersey"), never just the top result. Under it, results come in groups, always in this order: <strong>Compare</strong>, <strong>Places</strong>, <strong>Teams</strong>, <strong>Events</strong>, <strong>Matches</strong>, then site pages. A list of events puts Events before Teams. Each group shows how many it holds, up to 25 results in all.</p>
            <p>A comparison is its own card above the teams and is never counted as a team. Team cards carry the season record, OPR and its rank; event cards carry the event type, place and season. When some team matches are only close (a typo, part of a name), the exact ones are listed first and the rest are set apart below them.</p>
          </Prose>
        </section>

        {/* ================= 06 NO MATCH ================= */}
        <section id="nothing" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="06" eyebrow="When nothing fits" title="It tells you, instead of guessing" />
          <EmptyFigure />
          <Prose>
            <p>When no team, event or match matches all of your words, the page says so plainly and shows what it understood. Below that come up to ten <strong>closest matches</strong>, each labelled "not an exact match" and showing which of your words it did match, plus links to browse every event and team. A closest match is a lead to check, not an answer.</p>
          </Prose>
        </section>

        {/* ================= 07 NO AI ================= */}
        <section id="rules" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="07" eyebrow="Fixed rules" title="No AI decides what you meant" />
          <Prose>
            <p>FTC One Search follows fixed rules written in code: the steps above, in that order, with the word lists and patterns described on this page. It doesn't guess what you meant the way a person would. The same query gives the same answer every time, and when a rule doesn't fit, it says so rather than filling the gap.</p>
            <p>On some results pages a separate card labelled <strong>Bruno AI</strong> offers a short written summary of the results. It's only for questions, it's written from the records already on the page, it checks its own numbers against them (any number it can't back up drops its summary), and it says to check it before relying on it. It's an extra on top of the results. It never changes what the search found.</p>
          </Prose>
        </section>

        {/* ================= 08 LIMITS ================= */}
        <section id="limits" className="scroll-mt-bar-20 pt-20 pb-10">
          <SectionHead num="08" eyebrow="Honest limits" title="What it can't do (yet)" />
          <Prose>
            <CleanList items={[
              <><strong>Close matches can miss.</strong> Typo tolerance and word-start matching find most names, but a short word or a very different spelling can match the wrong team or nothing. Close matches are always labelled.</>,
              <><strong>Word-start matching has edges.</strong> Words are matched from the start, so the middle of a word won't match by itself: "notic" doesn't find Hypnotic Robotics.</>,
              <><strong>No distances or location.</strong> "Near" reads as "in", and "near me" can't know where you are. Counties aren't on record.</>,
              <><strong>Only what the data holds.</strong> OPR (without penalties) and its parts, wins, scores, rankings, awards and advancement. There's nothing on robot specs, rosters, budgets, social media or reputation, and the page says so when you ask.</>,
              <><strong>No all-time record across games.</strong> Each season's game scores differently, so high scores are kept per season. Scrimmages and off-season events don't count toward them.</>,
              <><strong>Only what FIRST has published.</strong> A team's next event or match shows once FIRST has posted it.</>,
            ]} />
            <p>Found a query that should work and doesn't? <Link to="/contact">Tell us</Link>, with what you typed.</p>
          </Prose>
        </section>
      </div>
    </TipLayer>
  );
}

/** The hero card: a worked query being read, word by word, cycling through READINGS. */
function QueryCard() {
  const reduced = useReduced();
  const [idx, setIdx] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const onScreen = useInView(card);
  const r = READINGS[idx];
  // Type the query out, then let its words light up (all at once under reduced motion).
  const [typed, setTyped] = useState(reduced ? r.q.length : 0);
  useEffect(() => {
    if (reduced) { setTyped(r.q.length); return; }
    setTyped(0);
    let n = 0;
    const t = setInterval(() => { n += 1; setTyped(n); if (n >= r.q.length) clearInterval(t); }, 45);
    return () => clearInterval(t);
  }, [r.q, reduced]);
  useEffect(() => {
    if (reduced || paused || !onScreen) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % READINGS.length), 5600);
    return () => clearInterval(t);
  }, [reduced, paused, cycle, onScreen]);
  const pick = useCallback((i: number) => { setIdx(i); setCycle((c) => c + 1); }, []);
  const done = typed >= r.q.length;

  return (
    <div ref={card} role="group" aria-label="Example queries and how they're read" className="lift overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground" aria-label={r.q}>
          <span aria-hidden>{r.q.slice(0, typed)}</span>
          {!done && <span aria-hidden className="ml-px inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
        </span>
        <Link to={searchHref(r.q)} className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground">Run it</Link>
      </div>
      <div className="grid min-h-[9.5rem] content-start gap-3 px-4 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Read as</p>
        <div className="flex flex-wrap gap-2" aria-live="polite">
          {r.words.map((w, i) => (
            <m.span
              key={`${r.q}-${w.w}`}
              initial={reduced ? false : { opacity: 0, y: 8, scale: 0.9 }}
              animate={done ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.9 }}
              transition={{ type: "spring", stiffness: 420, damping: 28, delay: reduced ? 0 : i * 0.09 }}
              className="grid gap-0.5"
            >
              <span className={cn("rounded-md border px-2 py-1 font-mono text-sm", ROLE[w.role].cls)}>{w.w}</span>
              <span className="px-0.5 font-mono text-[10px] text-muted-foreground">{ROLE[w.role].label}</span>
            </m.span>
          ))}
        </div>
      </div>
      <p className="min-h-[3.2em] border-t border-border px-4 py-2.5 text-sm text-foreground/85"><span className="hiw-gold-text font-semibold">→ </span>{r.result}</p>
      <div role="group" aria-label="Example queries" className="flex items-center pb-1 pl-1 pr-4 md:gap-1 md:pb-3 md:pl-4">
        {READINGS.map((x, i) => (
          <button
            key={x.q} type="button" aria-label={x.q} aria-pressed={i === idx} onClick={() => pick(i)}
            className="group grid size-[44px] shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-6"
          >
            <span className={cn("block h-2 rounded-full transition-all duration-500", i === idx ? "w-6 bg-accent" : "w-2 bg-border group-hover:bg-muted-foreground")} />
          </button>
        ))}
        {!reduced && (
          <button type="button" onClick={() => setPaused((v) => !v)} aria-pressed={paused} aria-label={paused ? "Resume cycling examples" : "Pause cycling examples"}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}{paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}

/** Figure 1: the six steps. Tap (or Enter/Space on) a step to open its detail. */
function StepsFigure() {
  const [open, setOpen] = useState(-1);
  const toggle = (i: number) => setOpen((o) => (o === i ? -1 : i));
  const s = open >= 0 ? SEARCH_STEPS[open] : null;
  return (
    <Figure label="Figure 1" title="From what you type to an answer" note="tap a step"
      caption={<>Each step tries to answer; if it can't, the query moves right. The last step is the honest "nothing matched" page.</>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {SEARCH_STEPS.map((st, i) => (
          <button
            key={st.title} type="button" aria-expanded={open === i} aria-controls="hiw-search-step" onClick={() => toggle(i)}
            className={cn(
              "hiw-stage pop relative grid min-w-0 content-start gap-1.5 rounded-xl border p-3.5 text-left transition-[transform,border-color,background-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:border-accent motion-reduce:hover:translate-y-0",
              open === i ? "-translate-y-1 border-accent bg-card motion-reduce:translate-y-0" : "border-border bg-muted/50",
            )}
            style={{ ["--i" as string]: i }}
          >
            <span className="hiw-gold font-display text-3xl font-bold leading-none">{i + 1}</span>
            <b className="font-display text-[0.9375rem] font-semibold text-foreground">{st.title}</b>
            <span className="text-sm leading-snug text-muted-foreground">{st.body}</span>
            <span className="mt-1 border-t border-dashed border-border pt-2 font-mono text-xs text-foreground">“{st.example}”</span>
          </button>
        ))}
      </div>
      <div id="hiw-search-step" className="hiw-expand mt-3" data-open={s ? "" : undefined} aria-live="polite">
        <div>
          {s && (
            <div className="grid gap-2 border-t border-border pt-3">
              <p className="text-[0.9375rem] leading-relaxed text-foreground/85"><b className="font-display text-foreground">{s.title}.</b> {s.detail}</p>
              <Link to={searchHref(s.example)} className="inline-flex w-fit items-center gap-1 font-mono text-xs text-foreground underline decoration-accent underline-offset-2">Try “{s.example}” <ArrowUpRight className="size-3.5" /></Link>
            </div>
          )}
        </div>
      </div>
    </Figure>
  );
}

/** Figure 2: one worked query, each word tagged with the job it was given. */
function ReadingFigure() {
  const [i, setI] = useState("0");
  const r = READINGS[Number(i)];
  const used = [...new Set(r.words.map((w) => w.role))];
  return (
    <Figure label="Figure 2" title="How a query is read" note="pick a query"
      actions={<Seg label="Example query" value={i} onChange={setI} options={READINGS.map((x, k) => ({ value: String(k), label: x.q }))} />}
      caption={<>Worked readings of four real queries. Words are tagged by the rules on this page; skipped words never have to match.</>}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3" key={i}>
          {r.words.map((w, k) => (
            <span key={w.w} className="pop grid gap-1" style={{ ["--i" as string]: k }}>
              <span className={cn("rounded-lg border px-3 py-2 font-mono text-base sm:text-lg", ROLE[w.role].cls)}>{w.w}</span>
              <span className="px-0.5 font-mono text-[11px] text-muted-foreground">{ROLE[w.role].label}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-[0.9375rem] text-foreground"><span className="hiw-gold-text font-semibold">→ </span>{r.result}</p>
          <Link to={searchHref(r.q)} className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline decoration-accent underline-offset-2">Run it <ArrowUpRight className="size-3.5" /></Link>
        </div>
        <p className="sr-only">Roles used: {used.map((u) => ROLE[u].label).join(", ")}</p>
      </div>
    </Figure>
  );
}

/** Figure 3: the shape of a results page (an illustration, not a live result). */
function ResultsFigure() {
  const groups: { name: string; n: number | null; rows: string[]; note?: string }[] = [
    { name: "Compare", n: null, rows: ["4215 Hypnotic Robotics vs 6980 Bad Wolf"], note: "its own card, not counted as a team" },
    { name: "Teams", n: 2, rows: ["4215 · Hypnotic Robotics", "6980 · Bad Wolf"] },
    { name: "Events", n: 1, rows: ["New Jersey Championship"] },
  ];
  return (
    <Figure label="Figure 3" title="The parts of a results page" note="illustration" narrow
      caption={<>The layout of a results page for “4215 vs 6980”, simplified. The real page adds each card's stats.</>}>
      <div className="grid gap-3">
        <div className="pop rounded-xl border border-accent bg-muted/40 p-3" style={{ ["--i" as string]: 0 }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">FTC One Search</p>
          <p className="font-display text-lg font-semibold text-foreground">Compare: Hypnotic Robotics (4215) vs Bad Wolf (6980)</p>
          <p className="font-mono text-xs text-muted-foreground">the title names what was understood</p>
        </div>
        {groups.map((g, k) => (
          <div key={g.name} className="pop grid gap-1.5 rounded-xl border border-border p-3" style={{ ["--i" as string]: k + 1 }}>
            <p className="flex items-center gap-2 font-display text-sm font-semibold text-foreground">
              {g.name}
              {g.n != null && <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">{g.n}</span>}
              {g.note && <span className="font-mono text-[11px] font-normal text-muted-foreground">· {g.note}</span>}
            </p>
            {g.rows.map((row, j) => (
              <span key={row} className="bar-h block rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground" style={{ ["--i" as string]: k + j }}>{row}</span>
            ))}
          </div>
        ))}
      </div>
    </Figure>
  );
}

/** Figure 4: the "nothing matched" page (an illustration). */
function EmptyFigure() {
  return (
    <Figure label="Figure 4" title="When nothing matches exactly" note="illustration" narrow
      caption={<>Closest matches are listed with the words they share with your query, and never shown as the answer.</>}>
      <div className="grid gap-3">
        <div className="pop rounded-xl border border-border bg-muted/40 p-3" style={{ ["--i" as string]: 0 }}>
          <p className="font-display text-base font-semibold text-foreground">Nothing matched “hypnotic zebras” exactly.</p>
          <p className="font-mono text-xs text-muted-foreground">We understood: No team, event or match matched all of “hypnotic zebras”</p>
        </div>
        <div className="pop grid gap-1.5 rounded-xl border border-dashed border-border p-3" style={{ ["--i" as string]: 1 }}>
          <p className="font-display text-sm font-semibold text-foreground">Closest matches <span className="font-mono text-[11px] font-normal text-muted-foreground">(not an exact match)</span></p>
          <span className="bar-h flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground" style={{ ["--i" as string]: 2 }}>
            <span>4215 · Hypnotic Robotics</span><span className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">matched: hypnotic</span>
          </span>
          <span className="bar-h flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground" style={{ ["--i" as string]: 3 }}>
            <span>24173 · E.Z. (Electric Zebras)</span><span className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">matched: zebras</span>
          </span>
        </div>
      </div>
    </Figure>
  );
}
