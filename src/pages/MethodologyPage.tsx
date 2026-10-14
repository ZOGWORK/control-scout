// How it works: every number on the site, explained plainly, with the real
// numbers. Rendered inside the app shell (sidebar, header and mobile tabs
// stay); the figures and interactives live in src/components/howitworks/.
// Two sources of accuracy numbers are kept apart throughout: this site's own
// ledger (live and backtest, from the API) and the shared engine's published
// held-out test.
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, FlaskConical } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { useTitle } from "../lib/meta";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import "../components/howitworks/howitworks.css";
import { Hero } from "../components/howitworks/Hero";
import { SectionNav, scrollToId } from "../components/howitworks/SectionNav";
import { Pipeline } from "../components/howitworks/Pipeline";
import { CarryOver, GainChart, LearnSim, RatingChips, WorkedUpdate } from "../components/howitworks/RatingFigures";
import { BellFigure, Playground } from "../components/howitworks/MatchFigures";
import { PointsChart, QualifierSim, RunFlow } from "../components/howitworks/EventFigures";
import { AccuracySection } from "../components/howitworks/AccuracySection";
import { BreakChart, Verdicts } from "../components/howitworks/LabNotes";
import { CleanList, Prose, Reveal, SectionHead, TipLayer, useReduced } from "../components/howitworks/ui";
import { CAL, MODEL, NOISE, RATING } from "../components/howitworks/math";

/** Event simulations per forecast (server/app.ts → forecast(…, 2000)). */
const SIM_RUNS = 2000;

export default function MethodologyPage() {
  useTitle("How it works");
  const reduced = useReduced();
  const { hash } = useLocation();
  // Deep links (/methodology#confidence etc.): wait for the page to lay out, then scroll.
  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    const t = setTimeout(() => scrollToId(id, true), 80);
    return () => clearTimeout(t);
  }, [hash]);

  return (
    <TipLayer>
      <div className={cn("hiw", !reduced && "hiw-anim")}>
        <Hero />
        <SectionNav />

        {/* ================= 01 OVERVIEW ================= */}
        <section id="overview" className="scroll-mt-20">
          <SectionHead num="01" eyebrow="The big picture" title="Four steps, from match history to advancement odds" />
          <Prose>
            <p>Predictions are a chain. Each link feeds the next, and every number you see in the app comes out the end of it. First the engine learns how strong every robot is from the matches it has already played. Then it turns two alliances' strengths into a win probability and a likely score. Then it plays out a whole event thousands of times. Finally it applies the season's advancement rules to see who qualifies in each of those versions.</p>
          </Prose>
          <Pipeline />
          <Prose id="data">
            <h3>Where the data comes from</h3>
            <p>Matches, schedules, score breakdowns, rankings, alliances, awards and advancement come from the official <strong>FIRST Events API</strong>. If FIRST can't serve an event, Control Scout falls back to <strong>FTC Scout</strong>. When the two sources were checked against each other on the same events, every score component matched. Past seasons are frozen once complete. The current season refreshes daily, and hourly while events are running. Seasons covered: 2023–24 CENTERSTAGE, 2024–25 INTO THE DEEP, 2025–26 DECODE and 2026–27 BIOBUZZ.</p>
            <p>No signal at the venue? A downloadable <Link to="/download">offline pack</Link> carries every team's ratings, and match predictions run on your device with the very same engine.</p>
          </Prose>
        </section>

        {/* ================= 02 RATINGS ================= */}
        <section id="ratings" className="scroll-mt-20 pt-20">
          <SectionHead num="02" eyebrow="Step one" title="A rating is a guess at how many points a robot adds" />
          <Prose id="rating">
            <p>FTC has a scoring problem for anyone trying to rate teams: you never see one robot's score, only the alliance's. The engine handles that the way the best FRC rating systems do. Each robot carries an <strong>expected contribution</strong>, in real game points, to whatever alliance it plays on. It's split into four parts, because a robot that's great in auto and weak in endgame is a different partner from one that's the other way around.</p>
          </Prose>
          <RatingChips />
          <Prose>
            <h3>How a rating moves after a match</h3>
            <p>After every match, the engine compares what each alliance was expected to score in each part with what it actually scored. The miss is split equally between the two robots, and each robot's rating moves by a fraction of its share. That fraction is the <strong>gain</strong>.</p>
            <WorkedUpdate />
            <p>The gain starts high, so a team's first few matches teach the engine a lot, and it shrinks as evidence builds up. It never drops below a floor, so a team that genuinely improves mid-season still gets noticed.</p>
          </Prose>
          <GainChart />
          <LearnSim />
          <Prose>
            <h3>Three more things a rating knows</h3>
            <CleanList items={[
              <><strong>Robots get better during a season.</strong> A rating grows by {Math.round(RATING.growthPerWeek * 100)}% for every week since the team last played, for up to {RATING.growthMaxWeeks} weeks. Two months between a team's first qualifier and its next one is a lot of build time.</>,
              <><strong>How sure it is.</strong> Each rating carries an uncertainty. A team the engine knows from last season starts at {RATING.uncKnown} points², a team with no history at {RATING.uncRookie}. Each match shrinks that to {Math.round(RATING.uncDecay * 100)}% of what it was, so after a handful of matches the engine is fairly confident. The "±" next to a rating on a team page is this uncertainty, as one standard deviation in points.</>,
              <><strong>Last season, a little.</strong> Games change every year, so points don't carry over. Instead, a team's final rank within its season becomes a z-score (how many standard deviations above or below average it was). That carries into the new season at {Math.round(RATING.rho1 * 100)}% weight, plus {Math.round(RATING.rho2 * 100)}% of the season before. Teams with no history start a bit below average (z = −{Math.abs(RATING.rookieZ)}), which matches how rookies actually do.</>,
            ]} />
          </Prose>
          <CarryOver />
          <Prose id="opr">
            <h3>OPR, the number most sites show</h3>
            <p>OPR estimates each robot's average contribution to its alliance's score. It's solved from an event's qualification matches, with separate values for auto, TeleOp, endgame and penalties given away. The headline OPR counts non-penalty points only, so an opponent's fouls don't inflate it.</p>
            <p>Control Scout computes OPR <strong>exactly the way FTC Scout and FTC Events do</strong>, so a team sees the same number everywhere: plain least squares over every played qualification match, counting every team FIRST lists on the alliance. TeleOp means what FIRST means by it: from 2024–25 on it includes the endgame points, and the endgame column shows that part on its own. A team's season OPR is its best event OPR. With only five or six matches, least squares can swing a lot and even go slightly negative; that's the published number, and it's one reason predictions use the rating instead.</p>
            <p>OPR is shown on team pages for reference. It doesn't drive predictions: the rating above does, because it updates after every match and carries over between seasons.</p>
          </Prose>
        </section>

        {/* ================= 03 MATCHES ================= */}
        <section id="matches" className="scroll-mt-20 pt-20">
          <span id="match" aria-hidden className="block scroll-mt-20" />{/* old links: /methodology#match */}
          <SectionHead num="03" eyebrow="Step two" title="From two alliances to one probability" />
          <Prose>
            <p>To predict a match, the engine adds up each alliance's robots, then adds the penalty points the <em>other</em> alliance tends to give away. That's the expected score.</p>
            <p>FTC scores are noisy, though. A game piece falls out, a robot tips, a driver misses a park. So each expected score comes with a spread. Fitted on 2024–25, the typical miss is about <code>{NOISE.a} + {NOISE.b} × expected</code> points: bigger scores have bigger swings. On top of that goes the uncertainty in each robot's rating. A team the engine barely knows gets a wider curve.</p>
            <p>Draw both alliances as curves and ask how often red's curve lands to the right of blue's. That share is red's win probability.</p>
          </Prose>
          <BellFigure />
          <Prose>
            <h3>A final calibration touch</h3>
            <p>Even good models are a little over- or under-confident. So the engine applies <strong>Platt scaling</strong>: a tiny correction, fitted on 2024–25, that gently pulls probabilities toward 50% (multiply the log-odds by {CAL.a.toFixed(3)}, nudge by {CAL.b.toFixed(3)}). It keeps every prediction in the same order; only a call that was already within half a point of 50% can tip to the other side. It just makes "70%" mean 70%. On the test season it cut calibration error from 0.017 to 0.0105. Probabilities are never shown as 0% or 100% unless the match is already decided.</p>
          </Prose>
          <Playground />
          <Prose id="factors">
            <h3>The top 3 factors</h3>
            <p>On a prediction, the predicted margin splits <strong>exactly</strong> into four parts: the auto gap, the TeleOp gap, the endgame gap, and the difference in penalties each side gives away. The factors are the <strong>three largest</strong> of those four parts, so they explain most of the margin; the fourth (smallest) part makes up the rest. Each one is a piece of the actual prediction shown, never a separate story.</p>
          </Prose>
        </section>

        {/* ================= 04 EVENTS ================= */}
        <section id="events" className="scroll-mt-20 pt-20">
          <SectionHead num="04" eyebrow="Step three" title="Playing the whole event thousands of times" />
          <Prose id="advancement">
            <p>Advancing isn't about one match. It depends on your rank, who picks whom, the bracket and the awards. All of those interact, and there's no neat formula for the whole thing. So the engine does what a coach does in their head, only {SIM_RUNS.toLocaleString("en-US")} times over: it imagines the event.</p>
          </Prose>
          <RunFlow />
          <QualifierSim />
          <Prose>
            <h3>The details that make it realistic</h3>
            <CleanList items={[
              <><strong>A robot's day is drawn once per run.</strong> If a team is having a great day in one simulated event, it's great all day long, not great in one match and awful in the next. That's how real events feel.</>,
              <><strong>Played matches stay played.</strong> Halfway through quals, the engine keeps the real results and only simulates what's left. The same goes for real alliances and real playoff results once they happen.</>,
              <><strong>Ranking points follow the real rules.</strong> 2025–26 gives 3 for a win and 1 for a tie, plus movement, goal and pattern bonus RPs, whose odds rise with an alliance's score. The tiebreaker is average non-penalty score. Checked against official data, the rules match 99.7% of real rankings.</>,
              <><strong>Captains pick like real captains.</strong> Fitted on 2,072 real picks, captains favour strong robots and, a bit, high-ranked ones. The real first pick was in the model's top three about {Math.round(((MODEL.accuracy as { pickTop3: number }).pickTop3) * 100)}% of the time.</>,
              <><strong>Real brackets.</strong> Double elimination for 4, 6 or 8 alliances with the grand-final rematch, or a best-of-3 when there are only 2.</>,
              <><strong>Awards matter.</strong> In 2025–26, Inspire alone is worth 60 advancement points. The engine estimates award chances from a team's award history and robot strength, and they're a big part of why it beats a "top-ranked teams advance" guess.</>,
              <><strong>Slots are real, or labelled.</strong> When FIRST hasn't published an event's slot count, it's estimated from earlier events of the same type in the same region, and the event page says so.</>,
            ]} />
          </Prose>
          <PointsChart />
          <Prose>
            <h3>"What if we pick them?"</h3>
            <p>Because the simulator can force any pairing, the advancement tab answers partner questions. If you're likely to captain: "if we pick team X, our odds become…". If you're likely to be picked: "if captain Y picks us…". When this was tested on real alliances, knowing the actual partner cut the error on "this alliance wins the event" by about 16% compared with general after-quals odds (Brier 0.072 vs 0.086, in the engine's held-out test).</p>
            <p>For an event that has already happened, "Before the event" replays the ratings to the day before it started and hides its results. That's the forecast without hindsight.</p>
          </Prose>
        </section>

        {/* ================= 05 ACCURACY ================= */}
        <AccuracySection />

        {/* ================= 06 LAB NOTES ================= */}
        <section id="lab" className="scroll-mt-20 pt-20">
          <SectionHead num="06" eyebrow="Lab notes" title="What we tried, and what made the cut" />
          <Prose>
            <p>The engine improves through small experiments, each judged the same way: tune on 2024–25, test on 2025–26, and compare against the baselines on identical matches. An idea ships only if it helps calibration and doesn't make anything else worse. Plenty of good-sounding ideas don't make it. Control Scout and Control Point share these results because they share the engine.</p>
          </Prose>
          <Verdicts />
          <BreakChart />
        </section>

        {/* ================= 07 LIMITS ================= */}
        <section id="limits" className="scroll-mt-20 pt-20">
          <SectionHead num="07" eyebrow="Fine print" title="What the predictions can't know" />
          <Prose>
            <CleanList items={[
              <><strong>A new robot until it plays.</strong> If you rebuilt over the break, the engine still thinks you're the old robot until your first match.</>,
              <><strong>What a scout would see.</strong> Drivers having a bad day, how well two robots actually work together, field faults, and anything you'd notice in the pits.</>,
              <><strong>2026–27 BIOBUZZ bonus RPs</strong> (swarm and the two pollinator RPs) aren't modelled yet: the engine has no fitted bonus-RP model for this season, so simulated BIOBUZZ events count only win and tie ranking points. Rank estimates can run a little off until it's fitted.</>,
              <><strong>The 2025–26 bonus RPs</strong> were fitted on the season's earliest matches, because the bonuses didn't exist before.</>,
              <><strong>Three-team championship alliances</strong> aren't modelled yet.</>,
              <><strong>Which awards exist</strong> at an event is taken as known; who wins them is predicted.</>,
              <><strong>This season's advancement rules.</strong> Until FIRST publishes 2026–27 advancement rules that differ, the 2025–26 points system is assumed.</>,
            ]} />
            <Reveal>
              <blockquote className="my-8 border-l-[6px] border-accent py-1 pl-5 font-display text-2xl font-bold leading-tight text-foreground sm:text-[1.9rem]">
                Treat it like a scouting report from someone who has watched every match ever played. It's very good, but it's still a forecast.
              </blockquote>
            </Reveal>
            <p>A 75% chance means one in four times the other thing happens. That's not the engine being wrong; that's what 75% means. Over a season, the calibration chart above is the promise the predictions actually make: when they say 75%, it happens about three times in four. Use the numbers as one input, not the answer.</p>
          </Prose>
        </section>

        {/* ================= SETTINGS ================= */}
        <section id="settings" className="scroll-mt-20 pt-20">
          <SectionHead eyebrow="For the curious" title="The settings, in one table" />
          <SettingsTable />
          <Prose id="engine" className="mt-8">
            <h3>One engine, two apps</h3>
            <p>Predictions come from <code>@control-scout/predict-engine</code> v{ENGINE_VERSION}. Control Point runs the exact same package and version, so the numbers you see here are the numbers Control Point shows for the same teams. Any change that could move a number needs a version bump and a held-out backtest showing it's at least as good.</p>
          </Prose>
        </section>

        <footer className="mx-auto mt-20 flex max-w-2xl flex-wrap items-center justify-between gap-4 border-t-2 border-foreground pt-5 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 basis-64">Control Scout · predictions by the shared engine v{ENGINE_VERSION} · settings fitted on {MODEL.fittedOn}.</span>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link to="/predict"><FlaskConical /> Predict <ArrowRight /></Link></Button>
          </div>
        </footer>
      </div>
    </TipLayer>
  );
}

function SettingsTable() {
  const rows: [string, string, string][] = [
    ["First-match gain", String(RATING.k0), "How far one match moves a new rating"],
    ["Gain halves after", `${RATING.n0} matches`, "How quickly a rating settles"],
    ["Gain floor", String(RATING.kMin), "Keeps late-season improvement visible"],
    ["Playoff weight", String(RATING.playoffWeight), "Eliminations count half"],
    ["Carry-over", `${RATING.rho1} / ${RATING.rho2}`, "Last season / the one before (as z-scores)"],
    ["Rookie start", `z = −${Math.abs(RATING.rookieZ)}`, "New teams start a bit below average"],
    ["Season growth", `${Math.round(RATING.growthPerWeek * 100)}% / week`, `Up to ${RATING.growthMaxWeeks} weeks between matches`],
    ["Uncertainty", `${RATING.uncKnown} / ${RATING.uncRookie} pts²`, `Known team / no history, ×${RATING.uncDecay} per match`],
    ["Score spread", `${NOISE.a} + ${NOISE.b} × score`, "Typical miss of an alliance score"],
    ["Event-start extra", `${NOISE.preExtra} pts²`, "Per robot, for predictions frozen at event start"],
    ["Calibration", `a ${CAL.a.toFixed(3)} · b ${CAL.b.toFixed(3)}`, "Platt scaling on win probabilities"],
    ["Captain's pick", `τ ${MODEL.pick.tau} · rank ${MODEL.pick.rankWeight}`, "How much strength vs. rank drives picks"],
    ["Simulations", SIM_RUNS.toLocaleString("en-US"), "Runs per event forecast"],
    ["OPR", "least squares", "Same method and numbers as FTC Scout and FTC Events"],
  ];
  return (
    <Reveal className="mx-auto max-w-2xl">
      <div className="custom-scrollbar overflow-x-auto rounded-2xl border border-border bg-card px-2 py-1 sm:px-3">
        <table className="w-full min-w-[480px] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Setting</th>
              <th scope="col" className="px-2 py-2.5 text-right font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Value</th>
              <th scope="col" className="px-2 py-2.5 text-left font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">What it does</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, d]) => (
              <tr key={k} className="border-b border-border last:border-0 transition-colors hover:bg-muted/50">
                <td className="px-2 py-2 text-foreground">{k}</td>
                <td className="whitespace-nowrap px-2 py-2 text-right font-mono text-foreground">{v}</td>
                <td className="px-2 py-2 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">Engine settings are read straight from the engine's fitted model: all fitted on 2024–25 and tested on 2025–26. The OPR ridge strength is Control Scout's own, fitted the same way.</p>
    </Reveal>
  );
}
