// How it works: every number on the site, explained plainly, with the real
// numbers. Rendered inside the app shell (sidebar, header and mobile tabs
// stay); the figures and interactives live in src/components/howitworks/.
// Two sources of accuracy numbers are kept apart throughout: this site's own
// ledger (live and backtest, from the API) and the shared engine's published
// held-out test.
import { Link } from "react-router-dom";
import { ArrowRight, FlaskConical } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { useTitle } from "../lib/meta";
import { REPORT_PRIOR } from "../shared/ledger";
import { RELIABILITY_PRIOR, RELIABILITY_WEIGHTS } from "../shared/reliability";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import "../components/howitworks/howitworks.css";
import { Hero } from "../components/howitworks/Hero";
import { SectionNav } from "../components/howitworks/SectionNav";
import { Pipeline } from "../components/howitworks/Pipeline";
import { CarryOver, GainChart, LearnSim, RatingChips, WorkedUpdate } from "../components/howitworks/RatingFigures";
import { BellFigure, Playground } from "../components/howitworks/MatchFigures";
import { PointsChart, QualifierSim, RunFlow } from "../components/howitworks/EventFigures";
import { AccuracySection } from "../components/howitworks/AccuracySection";
import { BreakChart, Verdicts } from "../components/howitworks/LabNotes";
import { CleanList, Prose, Reveal, SectionHead, TipLayer, useReduced } from "../components/howitworks/ui";
import { CAL, E2, E21, MODEL, NOISE, RATING } from "../components/howitworks/math";
import { PROJECTION_FLOOR, PROJECTION_RUNS } from "../shared/projections";

/** Event simulations per forecast (server/app.ts → forecast(…, 2000)). */
const SIM_RUNS = 2000;

export default function MethodologyPage() {
  useTitle("How it works");
  const reduced = useReduced();
  // Deep links (/methodology#confidence etc.) are scrolled to by the shell (src/lib/pageScroll.ts),
  // which also leaves Back alone when it returns to a position saved further down.

  return (
    <TipLayer>
      <div className={cn("hiw", !reduced && "hiw-anim")}>
        <Hero />
        <SectionNav />

        {/* ================= 01 OVERVIEW ================= */}
        <section id="overview" className="scroll-mt-bar-20">
          <SectionHead num="01" eyebrow="The big picture" title="Four steps, from match history to advancement odds" />
          <Prose>
            <p>Predictions are a chain. Each link feeds the next, and every number you see in the app comes out the end of it. First the engine learns how strong every robot is from the matches it has already played. Then it turns two alliances' strengths into a win probability and a likely score. Then it plays out a whole event thousands of times. Finally it applies the season's advancement rules to see who qualifies in each of those versions.</p>
          </Prose>
          <Pipeline />
          <Prose id="data">
            <h3>Where the data comes from</h3>
            <p>Matches, schedules, score breakdowns, rankings, alliances, awards and advancement come from the official <strong>FIRST Events API</strong>. If FIRST can't serve an event, Control Scout falls back to <strong>FTC Scout</strong>. When the two sources were checked against each other on the same events, every score component matched. Past seasons are frozen once complete. The current season refreshes daily and every 15 minutes on event days, and an event under way refreshes about every minute. Predictions cover 2023–24 CENTERSTAGE, 2024–25 INTO THE DEEP, 2025–26 DECODE and 2026–27 BIOBUZZ. Results and stats go back further, to 2019–20 SKYSTONE, 2020–21 ULTIMATE GOAL, 2021–22 FREIGHT FRENZY and 2022–23 POWERPLAY, so a team page shows how its robot did in those seasons too. Those older seasons are history only: the engine never rates or predicts them, so they leave every prediction unchanged. Remote events (mostly 2020–21 and 2021–22, when teams played alone on their own fields) keep their rankings and awards but no matches.</p>
            <p>No signal at the venue? A downloadable <Link to="/download">offline pack</Link> carries every team's ratings, and match predictions run on your device with the very same engine.</p>
          </Prose>
        </section>

        {/* ================= 02 RATINGS ================= */}
        <section id="ratings" className="scroll-mt-bar-20 pt-20">
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
            <p>Control Scout computes OPR the <strong>standard way</strong>: plain least squares over every played qualification match, counting every team FIRST lists on the alliance. TeleOp means what FIRST means by it: from 2024–25 on it includes the endgame points, and the endgame column shows that part on its own. A team's season OPR is its best event OPR. With only five or six matches, least squares can swing a lot and even go slightly negative; that's the published number, and it's one reason predictions use the rating instead.</p>
            <p>OPR is shown on team pages for reference. It doesn't drive predictions: the rating above does, because it updates after every match and carries over between seasons.</p>
          </Prose>
        </section>

        {/* ================= 03 MATCHES ================= */}
        <section id="matches" className="scroll-mt-bar-20 pt-20">
          <span id="match" aria-hidden className="block scroll-mt-bar-20" />{/* old links: /methodology#match */}
          <SectionHead num="03" eyebrow="Step two" title="From two alliances to one probability" />
          <Prose>
            <p>To predict a match, the engine adds up each alliance's robots, then adds the penalty points the <em>other</em> alliance tends to give away. That's the expected score.</p>
            <p>FTC scores are noisy, though. A game piece falls out, a robot tips, a driver misses a park. So each expected score comes with a spread. Fitted on 2024–25, the typical miss is about <code>{NOISE.a} + {NOISE.b} × expected</code> points: bigger scores have bigger swings. On top of that goes the uncertainty in each robot's rating. A team the engine barely knows gets a wider curve.</p>
            <p>Draw both alliances as curves and ask how often red's curve lands to the right of blue's. That share is red's win probability.</p>
          </Prose>
          <BellFigure />
          <Prose>
            <h3>Prediction Engine 2.0: reading the match, not just the score gap</h3>
            <p>Two curves only see the expected score gap. Since <strong>Prediction Engine 2.0</strong>, a small learned correction adjusts that probability using what the gap leaves out: where each side's points come from (auto, endgame, penalties), how lopsided each alliance is, how many matches each robot has played and how long since its last one, how sure the ratings are, whether it's a playoff, and three track-record signals per robot (does it beat or miss expectations, how much its alliances swing, how often they collapse). Those signals come from alliance scores, so they can't say which partner had the bad match; they're hints, not verdicts. Predicted scores and their ranges don't change.</p>
            <p>It was fitted on 2023–24 and 2024–25 matches, chosen and calibrated on early-2025 data, then frozen before it saw 2025–26. Replayed over the whole 2025–26 season (37,414 matches it never trained on, each predicted only from earlier results), it picked the winner {(100 * E2.accuracy).toFixed(2)}% of the time against {(100 * E2.baselineAccuracy).toFixed(2)}% before: <strong>+{(100 * (E2.accuracy - E2.baselineAccuracy)).toFixed(2)} points</strong> (95% range {(100 * E2.accuracyGain95[0]).toFixed(2)} to {(100 * E2.accuracyGain95[1]).toFixed(2)}). The Brier score fell from {E2.baselineBrier.toFixed(4)} to {E2.brier.toFixed(4)}. Not everything improved: one calibration measure got a little worse ({(100 * E2.baselineEce).toFixed(2)}% to {(100 * E2.ece).toFixed(2)}%), and a few late-season months lost a little accuracy. That's a replay of a past season, not a promise about this one, and the live track record keeps each engine version's calls apart.</p>
            <p><strong>Prediction Engine 2.1</strong> adds three more track-record signals: how a robot is doing <em>at this event so far</em>, whether its last few matches beat its usual level (momentum), and how recently its alliance collapsed. Tested month by month, with every setting fitted only on earlier matches, its probabilities scored better than 2.0's in both seasons tried (Brier {E21.season2024.baselineBrier.toFixed(4)} → {E21.season2024.brier.toFixed(4)} on later 2024–25 matches). Whether it picks more winners isn't settled: accuracy moved {(100 * (E21.season2024.accuracy - E21.season2024.baselineAccuracy)).toFixed(2)} and {(100 * (E21.season2025reused.accuracy - E21.season2025reused.baselineAccuracy)).toFixed(2)} points, within the noise. Both versions are now logged side by side on every live match, so the difference will be measured on the same games.</p>
            <h3>A final calibration touch</h3>
            <p>Even good models are a little over- or under-confident, so every probability gets a final two-number <strong>calibration</strong> step that gently pulls it toward 50% and keeps calls in the same order. It just makes "70%" mean 70%. When a device has ratings from before engine 2.0 (an old offline pack), it uses the original score-gap probability with its own correction (multiply the log-odds by {CAL.a.toFixed(3)}, nudge by {CAL.b.toFixed(3)}) until fresh ratings arrive. Probabilities are never shown as 0% or 100% unless the match is already decided.</p>
          </Prose>
          <Playground />
          <Prose id="factors">
            <h3>The top 3 factors</h3>
            <p>On a prediction, the predicted margin splits <strong>exactly</strong> into four parts: the auto gap, the TeleOp gap, the endgame gap, and the difference in penalties each side gives away. The factors are the <strong>three largest</strong> of those four parts, so they explain most of the margin; the fourth (smallest) part makes up the rest. Each one is a piece of the actual prediction shown, never a separate story.</p>
          </Prose>
          <Prose id="history">
            <h3>Earlier matches together</h3>
            <p>When two of the robots have really played on the same alliance, or against each other, the prediction says so, for example "1234 and 5678 have played 6 matches together (5–1); best 212 at the state championship". The history goes back to 2019–20. Each result is compared with what both teams' ratings expected at the time, so seasons with very different scores can be compared fairly. The line is a <strong>reason only</strong>: it doesn't change the odds. We tested blending it into the odds, with a heavy pull toward "no effect" for pairs that have played only a few matches. Fitted on 2023–24 and checked on the 2025–26 season it had never seen, the blend made the odds slightly worse. So the history is shown, not counted. With no connection, the downloaded pack keeps it small: only pairs that played together at least 3 times this season or last.</p>
          </Prose>
          <Prose id="report-cards">
            <h3>Report cards: how predictable a team has been</h3>
            <p>Each team page has a <strong>prediction report card</strong>: how the engine's calls on that team's matches turned out. It uses <strong>live calls only</strong>, the predictions written down before each match was played, never the replayed history. Three numbers: <strong>called right</strong> (the share of matches where the favoured side won; ties and exact 50/50 calls don't count), <strong>points vs prediction</strong> (the alliance's actual score minus its predicted score, split evenly between its robots, averaged: above zero means the team's alliances scored more than expected) and <strong>swing</strong> (the spread of those misses: a high swing means the team's matches are hard to call either way).</p>
            <p>A few matches say little, so every number is pulled toward the season's average over all teams, as if the team had {REPORT_PRIOR} more calls at that average. The card shows how many calls it rests on and the raw numbers beside it. Calls made before a season's first match have no predicted score: they count for called right only. Per-event cards appear once the event is over.</p>
          </Prose>
          <Prose id="reliability">
            <h3>Reliability: how dependable a robot has been</h3>
            <p>Next to OPR, team pages, Compare, pick lists and match reports show a <strong>reliability index</strong> from 0 to 100. It is an estimate made from qualification match results only, and its parts are always shown: <strong>no-shows</strong> (listed but not on the field), <strong>disqualifications</strong>, <strong>near-zero matches</strong>, <strong>swing</strong> (how much that estimated contribution moves from match to match), <strong>penalties</strong> given away against the season average, and how predictable its matches have been (the report card's miss spread). A near-zero match is when the alliance scored about what the partner's OPR alone would give. A robot playing defense, or a partner carrying the alliance, looks the same, so this is a hint and not proof of a dead robot.</p>
            <p>The index starts at 100 and loses {RELIABILITY_WEIGHTS.noShow} × the no-show rate, {RELIABILITY_WEIGHTS.dq} × the DQ rate, {RELIABILITY_WEIGHTS.nearZero} × the near-zero rate, {RELIABILITY_WEIGHTS.swing} × the swing, and up to {RELIABILITY_WEIGHTS.penalties * 1.5} each for penalties and predictability: nothing at half the season average or better, {RELIABILITY_WEIGHTS.penalties / 2} at the average, the full amount at twice it. Every part is pulled toward the season average as if the team had {RELIABILITY_PRIOR} more matches at it, so a few matches can't make a team look perfect or broken. These weights are a stated rule, not fitted. Members of a scouting workspace also see a second number that adds their own match notes (entries marked broken, disabled or no-show), clearly marked. Nobody outside that workspace ever sees it.</p>
          </Prose>
        </section>

        {/* ================= 04 EVENTS ================= */}
        <section id="events" className="scroll-mt-bar-20 pt-20">
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
              <><strong>Erratic robots spread wider.</strong> Each simulated score also gets match-to-match noise, sized for the alliance the same way the score ranges are: wider when its robots' results swing more than the model expects, or when one of them has played only a few matches this season.</>,
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
            <p>For an event that has already happened, "Before the event" replays the ratings to the day before it started and hides its results. Its bonus ranking point odds learn only from results played before the event started. That's the forecast without hindsight.</p>
          </Prose>
          <Prose id="projections">
            <h3>Live projections</h3>
            <p>Every live or upcoming event that advances teams is simulated {PROJECTION_RUNS.toLocaleString("en-US")} times in the background, once its qualification schedule is out, and again a few seconds after each new batch of results. Pages only read the stored result; nobody's visit starts a simulation. Each run samples every unplayed match's score from the engine's score model (never a coin flip), adds bonus ranking points, and seeds teams with the official tiebreakers. The table shows each team's median final rank and the range it lands in 80% of runs (10th–90th percentile), plus how far it has moved since the projection made before the first match.</p>
            <CleanList items={[
              <><strong>Pick model.</strong> Captains come straight from the simulated seeds; who gets picked follows the fitted pick model, a softmax over each robot's rating with a small weight on its seed.</>,
              <><strong>Advancement odds are performance-based — awards can also advance teams.</strong> They count quals rank, alliance and playoff points only; the simulator above adds award odds.</>,
              <><strong>Same results, same numbers.</strong> The random numbers are seeded by the event and its results so far. A very large event that would take over 10 seconds runs {PROJECTION_FLOOR.toLocaleString("en-US")} simulations instead, and the page says so.</>,
              <><strong>Checked on real events.</strong> Replaying 40 finished 2025–26 events from their midpoint, about 86% of teams (941 of 1,098) finished inside their projected 80% range.</>,
            ]} />
          </Prose>
        </section>

        {/* ================= 05 ACCURACY ================= */}
        <AccuracySection />

        {/* ================= 06 LAB NOTES ================= */}
        <section id="lab" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="06" eyebrow="Lab notes" title="What we tried, and what made the cut" />
          <Prose>
            <p>The engine improves through small experiments, each judged the same way: tune on 2024–25, test on 2025–26, and compare against the baselines on identical matches. An idea ships when it improves the probability scores (Brier and log loss) on identical held-out matches, and any trade-off it brings is written down here. Plenty of good-sounding ideas don't make it. Control Scout and Control Point share these results because they share the engine.</p>
          </Prose>
          <Verdicts />
          <BreakChart />
        </section>

        {/* ================= 07 LIMITS ================= */}
        <section id="limits" className="scroll-mt-bar-20 pt-20">
          <SectionHead num="07" eyebrow="Fine print" title="What the predictions can't know" />
          <Prose>
            <CleanList items={[
              <><strong>A new robot until it plays.</strong> If you rebuilt over the break, the engine still thinks you're the old robot until your first match.</>,
              <><strong>What a scout would see.</strong> Drivers having a bad day, how well two robots actually work together, field faults, and anything you'd notice in the pits.</>,
              <><strong>2026–27 BIOBUZZ bonus RPs</strong> (swarm and the two pollinator RPs) have no model shipped with the engine. Once about 100 of the season's qualification matches are recorded, simulations follow a curve fitted to its latest results. Before that, an event in progress draws them from its own recorded results, and otherwise simulated events count only win and tie ranking points; the forecast says which. Rank estimates can run a little off early in the season.</>,
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
        <section id="settings" className="scroll-mt-bar-20 pt-20">
          <SectionHead eyebrow="For the curious" title="The settings, in one table" />
          <SettingsTable />
          <Prose id="engine" className="mt-8 max-sm:mt-5">
            <h3>One engine, two apps</h3>
            <p>Predictions come from <strong>Prediction Engine 2.1</strong> (<code>@control-scout/predict-engine</code> v{ENGINE_VERSION}). Control Point runs the exact same package and version, so the numbers you see here are the numbers Control Point shows for the same teams. Any change that could move a number needs a version bump and a held-out backtest showing it's at least as good.</p>
          </Prose>
        </section>

        <footer className="mx-auto mt-20 flex max-w-2xl flex-wrap items-center justify-between gap-4 border-t-2 border-foreground pt-5 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 basis-64">Control Scout · predictions by Prediction Engine 2.1 (v{ENGINE_VERSION}), shared with Control Point · settings fitted on {MODEL.fittedOn}.</span>
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
    ["Win probability (2.0)", `${MODEL.contextual!.coefficients.length} inputs · slope ${MODEL.contextual!.calibration.slope.toFixed(3)}`, "Contextual correction of the score-gap probability, then its own calibration"],
    ["Calibration (fallback)", `a ${CAL.a.toFixed(3)} · b ${CAL.b.toFixed(3)}`, "Platt scaling, used when ratings carry no 2.0 track-record state"],
    ["Captain's pick", `τ ${MODEL.pick.tau} · rank ${MODEL.pick.rankWeight}`, "How much strength vs. rank drives picks"],
    ["Simulations", SIM_RUNS.toLocaleString("en-US"), "Runs per event forecast"],
    ["OPR", "least squares", "Standard least squares over qualification matches"],
  ];
  return (
    <Reveal className="mx-auto max-w-2xl">
      {/* A Tab stop (with a name) so a keyboard can scroll the table sideways on a phone. */}
      <div role="region" tabIndex={0} aria-label="Model settings" className="custom-scrollbar overflow-x-auto rounded-2xl border border-border bg-card px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 sm:px-3">
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
