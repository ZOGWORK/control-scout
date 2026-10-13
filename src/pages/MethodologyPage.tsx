// How it works: every number on the site, explained plainly — including what
// is a fitted value and what is a stated rule.
import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import type { TrackRecord } from "../shared/api";
import { PageHeader } from "../components/page";
import { pct } from "../lib/format";

function H({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="mt-10 scroll-mt-20 border-b border-border pb-2 font-display text-xl font-semibold">{children}</h2>;
}

export default function MethodologyPage() {
  useTitle("How it works");
  const t = useApi<TrackRecord>("/api/predict/accuracy").data;
  useEffect(() => { if (location.hash) setTimeout(() => document.querySelector(location.hash)?.scrollIntoView(), 50); }, []);
  const bt = t?.seasons.find((s) => s.season === 2025)?.backtest;
  return (
    <div className="max-w-3xl">
      <PageHeader title="How it works" description="Where the numbers come from, which ones are fitted to data, which are stated rules, and what the model can't see." />
      <div className="space-y-4 text-[15px] leading-relaxed text-foreground/90 [&_p]:text-muted-foreground [&_strong]:text-foreground">
        <H id="data">Data</H>
        <p>Matches, schedules, score breakdowns, rankings, alliances, awards and advancement come from the official <strong>FIRST Events API</strong>. If FIRST can't serve an event we fall back to <strong>FTC Scout</strong>. When we checked the two sources against each other on the same events, every score component matched. Past seasons are frozen once complete. The current season refreshes daily, and hourly while events are running. Seasons covered: 2023–24 CENTERSTAGE, 2024–25 INTO THE DEEP, 2025–26 DECODE and 2026–27 BIOBUZZ.</p>

        <H id="opr">OPR</H>
        <p>OPR estimates each robot's average contribution to its alliance's score. It's solved from an event's qualification matches, with separate values for auto, TeleOp, endgame and penalties given away. The headline OPR counts non-penalty points only, so an opponent's fouls don't inflate it.</p>
        <p>Plain least squares, which most sites use, swings wildly with five or six matches and can produce impossible negative ratings. We use a <strong>ridge-regularised, non-negative</strong> solve instead, which shrinks thin data toward the event's average robot. The shrinkage strength, λ = 0.5, was <strong>fitted</strong> by predicting held-out matches. It beat plain OPR on both 2024–25 and 2025–26. Alliances that included a surrogate or a disqualified robot are left out, because their score doesn't reflect normal play. A team's season OPR is its best event OPR from an event where it played at least four counted matches.</p>

        <H id="rating">Prediction rating</H>
        <p>The rating is what the engine expects a robot to add to its alliance <em>right now</em>, split into auto, TeleOp, endgame and penalties. It updates after every match, quickly at first and more steadily as a team plays more. Playoff matches count half. At the start of a season a team begins from its standing in previous seasons (decayed) rather than from zero. Rookies start from a fitted rookie prior with wider uncertainty. The "±" next to a rating is that uncertainty: one standard deviation, in points. Every setting here was tuned on 2024–25 and tested on 2025–26.</p>

        <H id="match">Match odds</H>
        <p>Each alliance's score is modelled as a normal distribution. The mean is the sum of its robots' ratings, plus the penalties the opponents tend to give away. The spread is game randomness, which grows with the score level (fitted), plus the rating uncertainty of each robot. Win probability is the chance one distribution beats the other. A final <strong>Platt calibration</strong>, also fitted on held-out matches, makes sure a stated 70% really comes true about 70% of the time. Probabilities are never shown as 0% or 100%.</p>
        {bt && <p>On 2025–26, predicting every match from only the matches before it, the favourite won <strong>{pct(bt.accuracy, 1)}</strong> of {bt.n.toLocaleString()} matches (Brier score {bt.brier.toFixed(3)}; a coin flip scores {bt.baselineBrier.toFixed(3)}). <Link to="/predict/accuracy" className="underline">Full track record</Link></p>}

        <H id="factors">The top 3 factors</H>
        <p>The predicted margin splits <strong>exactly</strong> into four parts: the auto gap, the TeleOp gap, the endgame gap, and the difference in penalties each side gives away. The factors are the <strong>three largest</strong> of those four parts, so they explain most of the margin; the fourth (smallest) part makes up the rest. Each one is a piece of the actual prediction shown, never a separate story.</p>

        <H id="confidence">Confidence tiers</H>
        <p>Every prediction carries a tier. These thresholds are a <strong>stated rule, not a fitted value</strong>:</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li><strong>Provisional:</strong> at least one robot has fewer than 3 matches this season, so its rating is mostly last season's.</li>
          <li><strong>Confident:</strong> every robot has at least 8 matches, and rating uncertainty is under 15% of the total uncertainty.</li>
          <li><strong>Moderate:</strong> everything in between.</li>
        </ul>
        <p>The track record reports accuracy per tier, so you can check the tiers mean something. In the 2025–26 backtest, provisional calls were right less often than moderate ones, and moderate less often than confident ones.</p>

        <H id="advancement">Advancement simulator</H>
        <p>We simulate the whole event 2,000 times. In each run every robot's true strength for the day is drawn once, and the unplayed qualification matches are played out with the real ranking-point and tiebreak rules. Alliance selection follows a pick model fitted to real selections, and the real double-elimination bracket is played. Judged awards are drawn from each team's award history. Advancement then follows that season's rules (points for 2025+, the fixed order for 2024). Matches already played keep their real results.</p>
        <p>For an event that has already happened, "Before the event" replays the ratings to the day before it started and hides its results. That's the forecast without hindsight. When FIRST hasn't published an event's slot count, it's estimated from earlier events of the same type in the same region, and the page says so.</p>

        <H id="ledger">Track record (the ledger)</H>
        <p>For every scheduled match, the prediction is written down <strong>before</strong> the match is played and is never revised, so the record can't learn the answer. Once results arrive, each call is scored. Past seasons are scored with a <strong>backtest</strong>: the season is replayed in order and each match is predicted only from earlier matches. Live and backtest are always reported separately.</p>

        <H id="limits">What the model can't see</H>
        <p>Robot changes between matches, drivers having a bad day, how well two robots actually work together, field faults, and anything a scout would notice in the pits. Use the numbers as one input, not the answer.</p>

        <H id="engine">One engine, two apps</H>
        <p>Predictions come from <code className="font-mono text-sm">@control-scout/predict-engine</code>. Control Point uses the exact same package and version, so the numbers you see here are the numbers Control Point shows for the same teams.</p>
      </div>
    </div>
  );
}
