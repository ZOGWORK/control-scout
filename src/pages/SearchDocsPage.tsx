// How FTC One Search works: what you can search for and how a query is
// answered, step by step, as the code does it (server/api/searchAnswer.ts).
// Written for search engines too: the H1, the opening paragraphs and every H2 are in the
// prerendered first paint (src/prerender/searchDocs.tsx), as plain text with no entrance motion.
// Under How it works in the menu, beside the prediction page, and built from its parts
// (src/components/howitworks/) so the two read and move alike. The words,
// steps and examples are data (src/components/howitworks/searchDocs.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useInView } from "motion/react";
import { ArrowUpRight, Pause, Play, PlayCircle, Search } from "lucide-react";
import { useTitle } from "../lib/meta";
import { cn } from "../components/cn";
import { m } from "../components/motion";
import "../components/howitworks/howitworks.css";
import { SectionNav } from "../components/howitworks/SectionNav";
import { CleanList, Eyebrow, Figure, Prose, Reveal, SectionHead, Seg, TipLayer, useReduced } from "../components/howitworks/ui";
import { READINGS, SEARCH_COMPLEX, SEARCH_FAMILIES, SEARCH_SHOWCASE, SEARCH_STEPS, SEARCH_VIDEO, type Role } from "../components/howitworks/searchDocs";

const searchHref = (q: string) => `/search?q=${encodeURIComponent(q)}`;

const SECTIONS = [
  { id: "what", label: "What" },
  { id: "use", label: "How to use" },
  { id: "answers", label: "Examples" },
  { id: "ask", label: "Plain words" },
  { id: "harder", label: "Harder questions" },
  { id: "video", label: "Video" },
  { id: "unique", label: "Unique" },
  { id: "steps", label: "Steps" },
  { id: "reading", label: "Reading" },
  { id: "results", label: "Results" },
  { id: "nothing", label: "No match" },
  { id: "rules", label: "No AI" },
  { id: "limits", label: "Limits" },
  { id: "next", label: "Next" },
] as const;

const ROLE: Record<Role, { label: string; cls: string }> = {
  team: { label: "team", cls: "border-accent bg-accent text-accent-ink" },
  versus: { label: "compare", cls: "border-foreground bg-foreground text-background" },
  stat: { label: "what to find", cls: "border-blue-alliance bg-blue-alliance/15 text-blue-alliance-text" },
  scope: { label: "which events", cls: "border-red-alliance bg-red-alliance/15 text-red-alliance-text" },
  kind: { label: "kind", cls: "border-red-alliance bg-red-alliance/15 text-red-alliance-text" },
  place: { label: "place", cls: "border-success bg-success/15 text-success" },
  time: { label: "time", cls: "border-border bg-muted text-foreground" },
  filter: { label: "leave out", cls: "border-warning bg-warning/15 text-warning-text" },
  and: { label: "next question", cls: "border-dashed border-foreground text-foreground" },
  filler: { label: "skipped", cls: "border-dashed border-border text-muted-foreground line-through" },
};

/** "Where to go next": each link names where it goes. */
const NEXT: { to: string; label: string; what: string }[] = [
  { to: "/search", label: "Search results page", what: "the full results for anything you type in the search bar at the top" },
  { to: "/teams", label: "FTC teams", what: "every team's season numbers, to filter, sort and compare" },
  { to: "/events", label: "FTC events", what: "every event, with results, rankings and advancement odds" },
  { to: "/predict", label: "Predict a match", what: "pick four teams and get win odds and a predicted score" },
  { to: "/methodology", label: "How the predictions work", what: "how OPR and the predictions are worked out, and how often they come true" },
];

/** The page's title (and the server's, server/seoMeta.ts): siteTitle adds " | Control Scout". */
export const PAGE_TITLE = "FTC One Search — the most powerful search engine for FTC";

export default function SearchDocsPage() {
  useTitle(PAGE_TITLE);
  const reduced = useReduced();
  return (
    <TipLayer>
      <div className={cn("hiw", !reduced && "hiw-anim")}>
        <header className="grid items-center gap-8 max-sm:gap-5 pb-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
          <div className="grid min-w-0 gap-5 max-sm:gap-4">
            <Eyebrow>Control Scout · Search, explained</Eyebrow>
            <h1 className="text-balance font-display text-[2.1rem] font-bold leading-[1.02] tracking-tight text-foreground sm:text-5xl xl:text-6xl">
              <span className="hiw-gold">FTC One Search</span> — the most powerful search engine for FTC
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-foreground/85 sm:text-xl">
              FTC One Search is the search bar on Control Scout, built to be the most powerful search engine for FTC: one box finds any team, event or match, answers questions about them from the stored records, and finds the videos of the matches themselves. Because it gives the answer in the search instead of a list of links, it's the most unique search tool for FTC scouting, and with OPR, predictions and advancement odds a few words away, it's the most powerful tool for FTC scouting.
            </p>
            <p className="max-w-xl text-base leading-relaxed text-foreground/85">
              Search any FTC team, event or match from one search bar, without logging in. Where the data exists, you get the answer in the search itself, not just a list of links. Answers come from stored FTC data, deterministically: the same query gives the same answer every time. Search is not a machine-learning model and does not require AI to return a result.
            </p>
            <p className="text-sm text-muted-foreground">Control Scout is a free FTC scouting platform at controlscout.org.</p>
          </div>
          <div className="min-w-0">
            <QueryCard />
          </div>
        </header>
        <SectionNav sections={SECTIONS} />

        {/* ================= 01 WHAT YOU CAN SEARCH ================= */}
        <section id="what" className="scroll-mt-bar-20">
          <SectionHead num="01" eyebrow="The big picture" title="What you can search" />
          <Prose>
            <CleanList items={[
              <><strong>Teams</strong>, by number, name or city: <code>4215</code>, <code>hypnotic robotics</code>, <code>teams in Oradell</code>.</>,
              <><strong>Events</strong>, by name, city or event code: <code>new jersey championship</code>, <code>events in Oradell</code>, <code>USNJCMP</code>.</>,
              <><strong>Matches</strong>, by event code and match number (<code>USNJCMPPKWY Q12</code>), or a team's matches by its number (<code>4215 matches</code>).</>,
              <><strong>Team stats</strong>, where the data exists: OPR and its auto and teleop splits, record, prediction rating, average score, awards, head-to-head, leaderboards and event history.</>,
              <><strong>Predictions and advancement odds</strong>, where the data exists: who would win between two teams, and a team's chances of advancing.</>,
              <><strong>Harder questions</strong>: two to four teams on one stat, a range of seasons, "not" filters, two places, two questions joined with "and", the game manual's rules, and when and where.</>,
              <><strong>Match videos</strong>, by team, event, place or season: <code>4215 videos at worlds</code>, <code>nj states videos</code>. They play right on the page.</>,
            ]} />
          </Prose>
        </section>

        {/* ================= 02 HOW TO USE ================= */}
        <section id="use" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="02" eyebrow="Getting started" title="How to use FTC One Search" />
          <Prose>
            <ol className="grid list-decimal gap-2.5 pl-5">
              <li>Go to <a href="https://controlscout.org/">controlscout.org</a>.</li>
              <li>Use the search bar at the top of the page.</li>
              <li>Type a team number, a team name, an event name or code, or a question about a team.</li>
              <li>Press Enter for full results. Select a result to open its team, event or comparison page.</li>
            </ol>
            <p>From the box, pressing Enter on a bare team number (<code>6980</code>, <code>team 6980</code>), one team's exact name or an exact event code goes straight to that page. Anything else opens the <Link to="/search">search results page</Link>, where the answer sits on top and the matching teams, events and matches are listed underneath.</p>
          </Prose>
        </section>

        {/* ================= 03 EXAMPLES ================= */}
        <section id="answers" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="03" eyebrow="Try one" title="Example searches" />
          <Prose>
            <p>Each card is a real query, run on the live site before it was listed here, with the kind of answer it returns. Tap one to run it. Answers are worked out from match and event records when you ask, and show their source (the match, event, season or date), so you can check them.</p>
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

        {/* ================= 04 ASK IN PLAIN WORDS ================= */}
        <section id="ask" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="04" eyebrow="What it can answer now" title="Ask in plain words" />
          <Prose>
            <p>Type a question the way you would ask a teammate. Each search below runs live when you tap it, and the answer is worked out from the records at that moment, so it stays current.</p>
          </Prose>
          <div className="mx-auto my-8 grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-2">
            {SEARCH_SHOWCASE.map((g) => (
              <Reveal key={g.title} className="min-w-0">
                <div className="hiw-panel grid h-full content-start gap-1 rounded-xl border border-border bg-card p-3.5">
                  <h3 className="px-1 pb-1 text-base font-semibold text-foreground">{g.title}</h3>
                  <ul className="grid gap-1">
                    {g.items.map((it) => <QueryLink key={it.q} q={it.q} what={it.what} />)}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
          <Prose>
            <p>Or type your own in the search bar at the top, or open the <Link to="/search">search results page</Link>.</p>
          </Prose>
        </section>

        {/* ================= 05 HARDER QUESTIONS ================= */}
        <section id="harder" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="05" eyebrow="More than one of each" title="Harder questions, answered in pieces" />
          <Prose>
            <p>A question can hold more than one of each slot: several teams, two places, a range of seasons, a filter that leaves some out, or two questions joined with "and". Each piece is read by the same rules as a short query, and the card names every piece it read, so you can see what was asked before you read the answer.</p>
          </Prose>
          <CompoundFigure />
          <div className="mx-auto my-8 grid max-w-5xl grid-cols-1 gap-3 md:grid-cols-2">
            {SEARCH_COMPLEX.map((g, i) => (
              <Reveal key={g.title} delay={(i % 2) * 0.06} className="min-w-0">
                <div className="hiw-panel grid h-full content-start gap-1 rounded-xl border border-border bg-card p-3.5 transition-[transform,border-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:border-accent motion-reduce:hover:translate-y-0">
                  <h3 className="px-1 text-base font-semibold text-foreground">{g.title}</h3>
                  <p className="px-1 pb-1 text-sm leading-snug text-muted-foreground">{g.body}</p>
                  <ul className="grid gap-1">
                    {g.items.map((it) => <QueryLink key={it.q} q={it.q} what={it.what} />)}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ================= 06 VIDEO ================= */}
        <section id="video" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="06" eyebrow="Not just numbers" title="Search match videos, and watch them here" />
          <Prose>
            <p>FTC One Search finds video too, not only answers. Add "videos" or "highlights" to a team, an event, a place or a season, and you get the matches that have video, each with its score and both alliances. "Highlights" picks the standout ones: the best score, the biggest margin, the closest finish, the latest playoff match.</p>
            <p>The video is the event's own: FIRST's video of that match, or the match's place in the event's official recording. Press Play and it opens in the app's player at that match's chapter, so there's no scrubbing through hours of a livestream to find it. The video stays where the event posted it: Control Scout links to it and never hosts a copy.</p>
          </Prose>
          <VideoFigure />
          <Reveal className="mx-auto my-8 max-w-3xl">
            <div className="hiw-panel rounded-xl border border-border bg-card p-3.5">
              <h3 className="px-1 pb-1 text-base font-semibold text-foreground">Try a video search</h3>
              <ul className="grid gap-1">
                {SEARCH_VIDEO.map((v) => <QueryLink key={v.q} q={v.q} what={v.what} />)}
              </ul>
            </div>
          </Reveal>
        </section>

        {/* ================= 07 UNIQUE ================= */}
        <section id="unique" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="07" eyebrow="Why it's different" title="What makes FTC One Search unique" />
          <Prose>
            <p><strong>One bar for everything.</strong> Teams, events, matches, stats, predictions and advancement all go in the same box, instead of separate filters or separate tools for each. That one bar is what makes FTC One Search the most powerful search engine for FTC.</p>
            <p><strong>Answers in search, with the numbers shown.</strong> Ask <code>4215 highest score in worlds</code> and the score, match, event and date are on the results page, instead of a link you have to open to find them. Answering in the search itself is what makes it the most unique search tool for FTC scouting.</p>
            <p><strong>Deterministic answers from stored data.</strong> Every answer is worked out from the stored records by fixed rules, with the season and what the number means stated on the answer (for example "OPR in 2025–26"). The same question gets the same answer every time, from OPR to predictions and advancement odds, and that is what makes it the most powerful tool for FTC scouting.</p>
          </Prose>
        </section>

        {/* ================= 08 STEPS ================= */}
        <section id="steps" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="08" eyebrow="Step by step" title="Six steps, and the first one that fits answers" />
          <Prose>
            <p>Every query goes through the same steps in the same order. Each step either answers it or passes it on. That's why the same words always give the same result, and why a more specific question (a team, a stat and an event together) is answered before a broad name search gets a go.</p>
          </Prose>
          <StepsFigure />
        </section>

        {/* ================= 09 READING ================= */}
        <section id="reading" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="09" eyebrow="Understanding a query" title="Every word gets a job, or gets skipped" />
          <ReadingFigure />
          <Prose>
            <h3>What it listens for</h3>
            <CleanList items={[
              <><strong>Places.</strong> A US state or Canadian province by its name or two-letter code, and a few Australian ones. Codes that are also English words (OR, IN, ME, HI, OK and others) count only in capitals, so "how many teams in OR" means Oregon while a lowercase "or" stays an ordinary word. In an event search, a state name with a small typo is read as the place, and the label says so. After "in", "at", "near" or "from", other words are read as a city or venue ("HS" matches "High School"). Countries work by name, and "USA", "UK" and "England" are understood.</>,
              <><strong>Time.</strong> Today, tomorrow, yesterday, this or next weekend, last week or month, upcoming, past, a month name, a year or a season, each read against today. "2024" means events held in 2024; "2023-24" means that season. A month belongs to the season it falls in (the season runs September to August). With no time given, events come from the current season, except championships, which cover every season.</>,
              <><strong>Seasons.</strong> A question about one team reads that team's latest season. A question about a place, a leaderboard or everyone reads the current season, and when it has nothing yet, the season before, said on the card. A season you type always wins.</>,
              <><strong>Any order.</strong> "Closest match in Romania last month" and "Romania last month closest match" are the same question: each word fills its slot wherever it is. Asides ("just curious", "if any") are skipped, never read as a team's name.</>,
              <><strong>Worked-out measures.</strong> Closest and most lopsided matches, upsets, comebacks, a team's losing streak and the teams it lost to are each worked out by one rule, printed on the card under "How this is counted". An upset is a favourite's loss: the losing alliance had over a 50% predicted chance, or, where no match there has a saved prediction, the larger summed season rating, and the card says which. What the data doesn't hold is never guessed.</>,
              <><strong>Kinds of events.</strong> Meet, qualifier, league, championship, scrimmage and the like, singular or plural. Short forms are understood too: "champs", "cmp", "quals", "worlds", "states".</>,
              <><strong>Comparisons.</strong> "vs", "versus", "v" or "against" between two to four teams opens Compare. "compare A and B", "is A better than B" and two bare team numbers are reworded to the same thing. "who would win A or B" adds the match prediction.</>,
              <><strong>Words it skips.</strong> Small words (in, at, on, the, a, an, for, of, this) never have to match, and question words (how, what, who, is, does…) are dropped when the query reads as a question. A friendly opening ("tell me about", "how good is") is set aside and the rest is searched.</>,
              <><strong>Names.</strong> Matched word by word from the start of each word, ignoring case and accents. A one-letter typo is forgiven in words of four to seven letters, two in longer words; a name typed without spaces still matches.</>,
            ]} />
          </Prose>
        </section>

        {/* ================= 10 RESULTS ================= */}
        <section id="results" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="10" eyebrow="The results page" title="The answer on top, the matches in groups below" />
          <ResultsFigure />
          <Prose>
            <p>The title names what was understood (for example "Upcoming meets in New Jersey"), never just the top result. Under it, results come in groups, always in this order: <strong>Compare</strong>, <strong>Places</strong>, <strong>Teams</strong>, <strong>Events</strong>, <strong>Matches</strong>, then site pages. A list of events puts Events before Teams. Each group shows how many it holds, up to 25 results in all.</p>
            <p>A comparison is its own card above the teams and is never counted as a team. Team cards carry the season record, OPR and its rank; event cards carry the event type, place and season. When some team matches are only close (a typo, part of a name), the exact ones are listed first and the rest are set apart below them.</p>
          </Prose>
        </section>

        {/* ================= 11 NO MATCH ================= */}
        <section id="nothing" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="11" eyebrow="When nothing fits" title="It tells you, instead of guessing" />
          <EmptyFigure />
          <Prose>
            <p>When nothing answers your words, the page says so in one sentence. Below that come the <strong>closest real results</strong>, up to three teams or events as full cards, then searches that do answer about them (a team's record or OPR, an event's winners), plus links to browse every event and team. A closest result is a lead to check, never the answer. A question about a team that search can't answer yet shows that team's card with what it can answer instead.</p>
          </Prose>
        </section>

        {/* ================= 12 NO AI ================= */}
        <section id="rules" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="12" eyebrow="Fixed rules" title="No AI decides what you meant" />
          <Prose>
            <p>FTC One Search follows fixed rules written in code: the steps above, in that order, with the word lists and patterns described on this page. It doesn't guess what you meant the way a person would. The same query gives the same answer every time, and when a rule doesn't fit, it says so rather than filling the gap. The order of a results list can follow which results people open most (counted clicks), but that only reorders the list: it never adds a result, and it never decides which team an answer is about.</p>
            <p>On some results pages a separate card labelled <strong>Bruno AI</strong> offers a short written summary of the results. It's only for questions, it's written from the records already on the page, it checks its own numbers against them (any number it can't back up drops its summary), and it says to check it before relying on it. It's an extra on top of the results. It never changes what the search found.</p>
          </Prose>
        </section>

        {/* ================= 13 LIMITS ================= */}
        <section id="limits" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="13" eyebrow="Honest limits" title="What it can't do (yet)" />
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

        {/* ================= 14 NEXT ================= */}
        <section id="next" className="scroll-mt-bar-20 pt-20 pb-10">
          <SectionHead num="14" eyebrow="Keep going" title="Where to go next" />
          <Prose>
            <CleanList items={NEXT.map((n) => <><Link to={n.to}>{n.label}</Link>: {n.what}</>)} />
          </Prose>
        </section>
      </div>
    </TipLayer>
  );
}

/** One example query as a link that runs it, with the kind of answer it returns under it. */
function QueryLink({ q, what }: { q: string; what: string }) {
  return (
    <li>
      <Link to={searchHref(q)} className="group grid min-h-11 gap-0.5 rounded-lg px-1 py-2 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-start gap-2 font-mono text-sm text-foreground">
          <Search aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-[color,transform] duration-300 group-hover:scale-110 group-hover:text-foreground motion-reduce:group-hover:scale-100" />
          <span className="min-w-0 flex-1 break-words">{q}</span>
          <ArrowUpRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-[color,transform] duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:group-hover:translate-x-0 motion-reduce:group-hover:translate-y-0" />
        </span>
        <span className="pl-[1.375rem] text-sm leading-snug text-muted-foreground">{what}</span>
      </Link>
    </li>
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
  // The count is kept with the query it belongs to: on the first render of a new example the old count is
  // for the old query, so the new one reads as untyped (not briefly "read" in full) until the effect resets it.
  const [progress, setProgress] = useState({ q: r.q, n: reduced ? r.q.length : 0 });
  useEffect(() => {
    if (reduced) { setProgress({ q: r.q, n: r.q.length }); return; }
    setProgress({ q: r.q, n: 0 });
    let n = 0;
    const t = setInterval(() => { n += 1; setProgress({ q: r.q, n }); if (n >= r.q.length) clearInterval(t); }, 45);
    return () => clearInterval(t);
  }, [r.q, reduced]);
  const typed = progress.q === r.q ? progress.n : reduced ? r.q.length : 0;
  useEffect(() => {
    if (reduced || paused || !onScreen) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % READINGS.length), 5600);
    return () => clearInterval(t);
  }, [reduced, paused, cycle, onScreen]);
  const pick = useCallback((i: number) => { setIdx(i); setCycle((c) => c + 1); }, []);
  const done = typed >= r.q.length;
  const running = !reduced && !paused && onScreen;
  // The answer lands once the last word's chip has.
  const answerDelay = reduced ? 0 : r.words.length * 0.09 + 0.2;

  return (
    <div ref={card} role="group" aria-label="Example queries and how they're read" className="lift relative overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)]">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Search aria-hidden className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground" aria-label={r.q}>
          <span aria-hidden>{r.q.slice(0, typed)}</span>
          {!done && <span aria-hidden className="ml-px inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-accent" />}
        </span>
        <Link to={searchHref(r.q)} className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground">Run it</Link>
      </div>
      <div className="grid min-h-[9.5rem] content-start gap-3 px-4 py-4">
        <p className="flex items-center justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Read as</span>
          <span aria-hidden className="inline-flex items-center normal-case tracking-normal">
            <span className={cn("hiw-live", running && "hiw-live-on")} />{done ? "read" : "reading…"}
          </span>
        </p>
        {/* Every reading's chips share one grid cell (the others invisible), so the card keeps the
            height of its tallest reading and stays centred beside the hero text as examples cycle. */}
        <div className="grid">
          {READINGS.map((x) => x !== r && (
            <div key={x.q} aria-hidden className="invisible col-start-1 row-start-1 flex flex-wrap gap-2">
              {x.words.map((w) => (
                <span key={w.w} className="grid gap-0.5">
                  <span className="rounded-md border px-2 py-1 font-mono text-sm">{w.w}</span>
                  <span className="px-0.5 font-mono text-[10px]">{ROLE[w.role].label}</span>
                </span>
              ))}
            </div>
          ))}
        <div className="col-start-1 row-start-1 flex flex-wrap gap-2" aria-live="polite">
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
      </div>
      <div className="grid min-h-[3.2em] border-t border-border px-4 py-2.5 text-sm text-foreground/85">
        {READINGS.map((x) => x !== r && (
          <p key={x.q} aria-hidden className="invisible col-start-1 row-start-1"><span className="font-semibold">→ </span>{x.result}</p>
        ))}
        <m.p
          key={r.q}
          className="col-start-1 row-start-1"
          initial={reduced ? false : { opacity: 0, y: 6 }}
          animate={done ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1], delay: done ? answerDelay : 0 }}
        ><span className="hiw-gold-text font-semibold">→ </span>{r.result}</m.p>
      </div>
      <div role="group" aria-label="Example queries" className="flex items-center pb-1 pl-1 pr-4 md:gap-1 md:pb-3 md:pl-4">
        {READINGS.map((x, i) => (
          <button
            key={x.q} type="button" aria-label={x.q} aria-pressed={i === idx} onClick={() => pick(i)}
            className="group grid size-[44px] shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-6"
          >
            <span className={cn("block h-2 rounded-full transition-[width,background-color] duration-300 ease-out", i === idx ? "w-6 bg-accent" : "w-2 bg-border group-hover:bg-muted-foreground")} />
          </button>
        ))}
        {!reduced && (
          <button type="button" onClick={() => setPaused((v) => !v)} aria-pressed={paused} aria-label={paused ? "Resume cycling examples" : "Pause cycling examples"}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}{paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
      {/* Time left on this example: a bar filling over the cycle (transform only), restarted with each example. */}
      {running && <span key={`${idx}-${cycle}`} aria-hidden className="hiw-timer pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-accent/70" />}
    </div>
  );
}

/** Figure 3: the six steps. Tap (or Enter/Space on) a step to open its detail. */
function StepsFigure() {
  const [open, setOpen] = useState(-1);
  const toggle = (i: number) => setOpen((o) => (o === i ? -1 : i));
  const s = open >= 0 ? SEARCH_STEPS[open] : null;
  return (
    <Figure label="Figure 3" title="From what you type to an answer" note="tap a step"
      caption={<>Each step tries to answer; if it can't, the query moves right. The last step is the honest "nothing matched" page.</>}>
      <div className="hiw-steps-wrap grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
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

/** Figure 4: one worked query, each word tagged with the job it was given. */
function ReadingFigure() {
  const [i, setI] = useState("0");
  const r = READINGS[Number(i)];
  const used = [...new Set(r.words.map((w) => w.role))];
  return (
    <Figure label="Figure 4" title="How a query is read" note="pick a query"
      actions={<Seg label="Example query" value={i} onChange={setI} options={READINGS.map((x, k) => ({ value: String(k), label: x.q }))} />}
      caption={<>Worked readings of real queries, short and long. Words are tagged by the rules on this page; skipped words never have to match.</>}>
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

/** Figure 5: the shape of a results page (an illustration, not a live result). */
function ResultsFigure() {
  const groups: { name: string; n: number | null; rows: string[]; note?: string }[] = [
    { name: "Compare", n: null, rows: ["4215 Hypnotic Robotics vs 6980 Bad Wolf"], note: "its own card, not counted as a team" },
    { name: "Teams", n: 2, rows: ["4215 · Hypnotic Robotics", "6980 · Bad Wolf"] },
    { name: "Events", n: 1, rows: ["New Jersey Championship"] },
  ];
  return (
    <Figure label="Figure 5" title="The parts of a results page" note="illustration" narrow
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

/** Figure 6: the "nothing matched" page (an illustration). */
function EmptyFigure() {
  return (
    <Figure label="Figure 6" title="When nothing answers" note="illustration" narrow
      caption={<>The closest real results are full cards under one sentence that says what's missing, and never shown as the answer.</>}>
      <div className="grid gap-3">
        <p className="pop font-display text-base font-semibold text-foreground" style={{ ["--i" as string]: 0 }}>Nothing in “hypnotic zebras” matched a team, event or place I know. These are the closest real results.</p>
        <div className="pop grid gap-1.5 rounded-xl border border-border p-3" style={{ ["--i" as string]: 1 }}>
          <span className="block rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground">4215 · Hypnotic Robotics · Oradell, NJ</span>
          <span className="block rounded-md bg-muted/60 px-2.5 py-1.5 font-mono text-xs text-foreground">24173 · E.Z. (Electric Zebras)</span>
        </div>
        <div className="pop flex flex-wrap gap-2" style={{ ["--i" as string]: 2 }}>
          {["4215 record", "4215 opr", "24173 record"].map((q) => <span key={q} className="rounded-lg border border-border px-2.5 py-1 font-mono text-xs text-foreground">{q}</span>)}
        </div>
      </div>
    </Figure>
  );
}

/** Figure 1: two questions joined with "and", split into one answer card each (an illustration). */
function CompoundFigure() {
  const q = "4215 opr and 6980 record";
  const r = READINGS.find((x) => x.q === q)!;
  const cards = [
    { title: "Hypnotic Robotics (4215) · OPR", body: "The season's OPR, with its rank and how OPR is counted" },
    { title: "Bad Wolf (6980) · Record", body: "Wins, losses and ties for the season, event by event" },
  ];
  return (
    <Figure label="Figure 1" title="One search, two answers" note="illustration"
      actions={<Link to={searchHref(q)} className="inline-flex items-center gap-1 font-mono text-xs text-foreground underline decoration-accent underline-offset-2">Run it <ArrowUpRight className="size-3.5" /></Link>}
      caption={<>The words are read once, split at "and", and each half is answered as if it had been asked alone. The cards stay in the order you asked.</>}>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-2">
          {r.words.map((w, k) => (
            <span key={w.w} className="pop grid gap-1" style={{ ["--i" as string]: k }}>
              <span className={cn("rounded-lg border px-2.5 py-1.5 font-mono text-sm sm:text-base", ROLE[w.role].cls)}>{w.w}</span>
              <span className="px-0.5 font-mono text-[11px] text-muted-foreground">{ROLE[w.role].label}</span>
            </span>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {cards.map((c, k) => (
            <div key={c.title} className="pop grid gap-1 rounded-xl border border-accent/60 bg-muted/40 p-3" style={{ ["--i" as string]: r.words.length + 2 + k * 2 }}>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Answer {k + 1}</p>
              <p className="font-display text-base font-semibold text-foreground">{c.title}</p>
              <span className="bar-h block h-1.5 rounded-full bg-accent/70" style={{ ["--i" as string]: r.words.length + 3 + k * 2 }} />
              <p className="text-sm leading-snug text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </Figure>
  );
}

/** Where each match sits in an event's recording (an illustration: share of the recording, 0 to 100). */
const CHAPTERS: { label: string; at: number }[] = [
  { label: "Q1", at: 6 }, { label: "Q2", at: 13 }, { label: "Q3", at: 21 }, { label: "Q4", at: 30 },
  { label: "SF1", at: 58 }, { label: "SF2", at: 67 }, { label: "F1", at: 84 }, { label: "F2", at: 92 },
];

/** Figure 2: Play opens the event's recording at that match's chapter. Cycles through the matches while on
 *  screen until one is picked; static under reduced motion. */
function VideoFigure() {
  const reduced = useReduced();
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const onScreen = useInView(box, { amount: 0.4 });
  useEffect(() => {
    if (reduced || picked || !onScreen) return;
    const t = setInterval(() => setAt((i) => (i + 1) % CHAPTERS.length), 2400);
    return () => clearInterval(t);
  }, [reduced, picked, onScreen]);
  const c = CHAPTERS[at];
  return (
    <Figure label="Figure 2" title="Play starts at the match, not the start of the stream" note="illustration · pick a match"
      caption={<>An event's recording runs for hours. Each match with video knows where it starts in that recording, so Play opens the app's player right there.</>}>
      <div ref={box} className="grid gap-3">
        <div className="relative grid h-36 place-items-center overflow-hidden rounded-xl border border-border bg-muted/60 sm:h-48">
          <div className="grid justify-items-center gap-1.5 text-center">
            <PlayCircle aria-hidden className="size-10 text-foreground/80 sm:size-12" />
            {/* Announced only once the reader picks a match, never on every automatic step. */}
            <p className="font-mono text-xs text-muted-foreground" aria-live={picked ? "polite" : "off"}>Event recording · playing <b className="text-foreground">{c.label}</b></p>
          </div>
        </div>
        {/* The recording's timeline: chapter ticks, the played part and the playhead move by transform alone. */}
        <div className="relative h-2 rounded-full bg-muted" aria-hidden>
          <span className="hiw-jump absolute inset-0 origin-left rounded-full bg-accent/70" style={{ transform: `scaleX(${c.at / 100})` }} />
          {CHAPTERS.map((x) => <span key={x.label} className="absolute top-0 h-2 w-px bg-background/80" style={{ left: `${x.at}%` }} />)}
          <span className="hiw-jump absolute inset-0" style={{ transform: `translateX(${c.at}%)` }}>
            <span className="absolute left-0 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-accent shadow" />
          </span>
        </div>
        <div role="group" aria-label="Matches in this recording" className="flex flex-wrap gap-1.5">
          {CHAPTERS.map((x, i) => (
            <button key={x.label} type="button" aria-pressed={i === at} onClick={() => { setAt(i); setPicked(true); }}
              className={cn("min-h-11 min-w-11 rounded-lg border px-2.5 font-mono text-xs transition-colors sm:min-h-8", i === at ? "border-accent bg-accent text-accent-ink" : "border-border text-muted-foreground hover:border-accent hover:text-foreground")}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
    </Figure>
  );
}
