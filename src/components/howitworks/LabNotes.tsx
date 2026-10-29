// Section 06: lab notes. What was tried on the shared engine, and what made the cut.
import { useId, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../cn";
import { HBars } from "./charts";
import { E2 } from "./math";
import { Figure, Reveal, ScrollX } from "./ui";

const n0 = (x: number) => x.toLocaleString("en-US");

type Verdict = "ship" | "no" | "off";
const TAG: Record<Verdict, { text: string; cls: string }> = {
  ship: { text: "Shipped", cls: "text-success" },
  no: { text: "Rejected", cls: "text-red-alliance" },
  off: { text: "Built, switched off", cls: "hiw-gold-text" },
};

const NOTES: { v: Verdict; title: string; body: string; more: string; wide?: boolean }[] = [
  {
    v: "ship", wide: true, title: "Engines 2.7–2.11: measure first, then fix the biggest weak spots",
    body: "A slice report replays every match and breaks the errors down by situation. Thin data dominated, so the fixes went there: regional starting points (2.7), a slightly bolder final calibration (2.8), form at the current event (2.9), slow-learning foul ratings (2.10) and alliance overlap (2.11). Each one beat the version before it on identical past matches, with no situation getting worse in the two seasons it was judged on (one exception in the earliest season is noted below).",
    more: "Brier change per release, 2024–25 (tuning) / 2025–26: 2.7 −3.3 / −2.4 ×10⁻⁴; 2.8 −0.7 / −1.9 (month-by-month, forward-only); 2.9 −1.5 / −1.8; 2.10 neutral on win odds, expected-score error 27.67 → 26.57 points on 2025–26; 2.11 −2.1 / −2.4. Winner accuracy barely moved: these make the stated chances truer rather than picking more winners. One exception: in 2023–24, which every replay starts cold, 2.10 made matches between well-known robots (16+ matches) slightly worse (+1.6 ×10⁻⁴), and 2.9 large events (+2.9). Every gate report is in docs/engine/gates in the repository.",
  },
  {
    v: "no", title: "Carrying endgame over less between seasons",
    body: "Last season predicts this season's endgame only half as well as auto and TeleOp. Carrying less of it over still made every situation slightly worse, so all phases still carry over alike.",
    more: "Season-to-season slopes: auto about 0.65, TeleOp about 0.65, endgame 0.13–0.33. Endgame carry-over 0.2–0.8 against 1: Brier +0.03 to +0.13 ×10⁻⁴ on both seasons.",
  },
  {
    v: "no", title: "Refitting the win-probability weights on newer data",
    body: "Refitting the 22 learned weights each month on everything before it gave only a marginal gain on 2025–26, a loss on 2024–25, and flipped the sign of three small weights. The frozen weights stay; they'll be revisited when a new season's data exists.",
    more: "Refit minus frozen, forward-only: 2025–26 −0.99 [−1.99, −0.01] ×10⁻⁴; 2024–25 +3.19 [+2.11, +4.23] (where the frozen weights had seen part of the season). Sign flips: three small inputs.",
  },
  {
    v: "no", title: "A separate calibration per situation",
    body: "Fitting the final calibration separately for quals and playoffs and for thin and dense data was only a little better than one shared stretch, and it cost a little accuracy. One stretch, with no colour term, shipped instead.",
    more: "2025–26 forward-only: −2.64 against −2.15 ×10⁻⁴ for a shared mapping; 2024–25 accuracy −0.13 points [−0.22, −0.05]. An intercept would have been a red/blue term, which isn't allowed.",
  },
  {
    v: "no", title: "A dead-robot mixture",
    body: "Modelling a chance that each robot does nothing in a match. The win odds were already right for fragile robots (within about 2 points at every level of fragility), and their score ranges already held. Their misses land above the range more often than below, the opposite of what a dead-robot term would fix.",
    more: "Top 10% by failure history, favourites at 80%+: stated 90.7% / won 88.8% ±2.0 (2024–25), 88.7% / 88.7% ±2.2 (2025–26). 80% ranges for those alliances covered 80.6% and 80.4%; 12.6% and 11.4% of all their scores landed above the range (about 60% of the misses).",
  },
  {
    v: "no", title: "A tuning pass over every rating setting",
    body: "Each of the 15 rating settings was swept on its own over one season. Twelve sat on a plateau at their current value. Moving the other three (slower between-event growth, more weight on playoff results) helped that season, but only through its playoffs, and made predictions for teams with little data worse in the two later seasons. Nothing changed.",
    more: "Candidate (growth 0.03 a week for up to 6 weeks, playoff weight 0.8) minus engine, Brier ×10⁻⁴: 2024–25 −2.51 [−4.55, −0.33], of which playoffs −18.26; 2023–24 +0.31; 2025–26 +0.60. Worse beyond noise: league meets in all three seasons; thin-data and first-event matches in 2024–25 and 2025–26; teams with 6–15 matches in 2023–24. Surfaces and the gate report in docs/engine/part12/tuning.md.",
  },
  {
    v: "no", title: "A free-form final calibration",
    body: "Swapping the one-number final stretch for a free-form monotone curve (isotonic regression). It was a little closer to the truth between 55% and 85%, but not clearly, and it cost a little probability quality. That the free-form curve finds the same shape is evidence the simple stretch is the right kind.",
    more: "Fitted month by month on the year before, isotonic minus stretch: Brier +0.90 [+0.13, +1.68] ×10⁻⁴ (2024–25), +0.07 [−0.85, +1.01] (2025–26); 55–85% calibration error 0.76 → 0.59 points [−0.57, +0.34] and 1.22 → 0.86 [−0.86, +0.17]. The month-by-month stretch stays between 1.03 and 1.09; the engine uses 1.058. Details in docs/engine/part12/isotonic.md.",
  },
  {
    v: "no", title: "A growth curve for rookies and second-year teams",
    body: "Young teams do improve during a season, but the engine already keeps up: its misses for rookies and second-year teams drift the same way as veterans' as matches pile up, not upward. There was no missing trajectory to add. What it did find: rookies start a little under-rated (by about 1–2 points, closing over the season), and every team is over-rated a little late in the season. Both went to the tuning pass.",
    more: "Miss per robot (points) by matches played, 2023–24 to 2025–26, slope per 10 matches: rookies −0.48, −0.51, −1.25; year 2 +0.06, −0.52, −0.52; veterans −0.29, −0.63, −0.42. Rookie minus veteran −0.19, +0.12, −0.82, changing sign. First 5 matches: rookies +1.1 to +1.5, veterans −0.6 to −1.2. Robots with 24–47 matches: −0.8 to −3.1 in every band. Details in docs/engine/part12/growth.md.",
  },
  {
    v: "no", title: "A blend with a second and third opinion",
    body: "Mixing the engine's win odds with a win/loss-only skill rating and a margin model. On the one season none of the models had learned from, the blend was slightly worse than the engine alone; on later seasons it was a hair better, but only where the engine had already seen the matches. Winner accuracy didn't change. One model stays.",
    more: "Blend minus engine, Brier ×10⁻⁴, blend fit on the season before: 2022–23 (fully held out) +1.61 [−0.54, +3.48]; 2023–24 −0.62 [−1.06, −0.12], 2024–25 −0.98 [−2.06, +0.16], 2025–26 −0.66 [−1.77, +0.41], where the engine's learned weights had seen part of the data. Typical change to a call 0.3–1.0%. The skill rating alone was much worse (Brier about 0.20 against 0.17), and the margin model, built from the engine's own ratings, got a small, unstable weight (+0.18 once, then −0.01 to −0.09). Details in docs/engine/part12/ensemble.md.",
  },
  {
    v: "ship", wide: true, title: "Prediction Engine 2.1: form at this event, momentum, collapses",
    body: "Five more inputs from each robot's recent record: its residuals at the current event, a fast-moving average against its usual level, whether its last alliance collapsed, and how long ago. Better probabilities in a clean month-by-month test; not yet shown to pick more winners.",
    more: "Re-tested forward-only (everything refitted from earlier matches before each month): Brier improved in later 2024–25 (0.15646 → 0.15589, 95% range −0.0009 to −0.0003) and 2025–26 (0.16894 → 0.16846); winner accuracy +0.17 and +0.06 points, both ranges including zero; calibration about the same. The first figures (+0.22 / +0.19 points) used a calibration fitted on later matches and 2025–26 vetoes, so they were corrected. Tried and dropped: alliance congestion, a defense rating, partner familiarity, a long-gap signal, extra uncertainty after a break and a score-mean correction; autonomous and role compatibility gained too little to replicate.",
  },
  {
    v: "no", title: "Simulated matches that follow the new odds",
    body: "Nudging each simulated score gap so event simulations agree with 2.0's match odds. It helped some later-stage advancement odds but made pre-event calibration and rank ranges worse.",
    more: "On 2024–25 (the deciding season), pre-event advancement Brier moved 0.0749 → 0.0742 but after-selection 0.0452 → 0.0455, rank error 5.21 → 5.27 and pre-event calibration error 0.85% → 1.03%. 2025–26 improved after selection (0.0636 → 0.0624). Mixed, so not shipped.",
  },
  {
    v: "no", title: "A bonus-RP model that keeps learning",
    body: "Refitting bonus-RP odds every week from the season's own results predicts each alliance's bonus RPs far better than a fit from the season's first weeks, but it didn't improve rank or advancement odds.",
    more: "On the later 80% of 2025–26: bonus-count log-likelihood −1.25 → −0.95, error 0.61 → 0.55 RPs per alliance. Event odds: pre-event advancement Brier 0.1057 → 0.1060, rank error 5.14 → 5.15. Kept as a lead for BIOBUZZ, which has no bonus model yet.",
  },
  {
    v: "ship", wide: true, title: "Prediction Engine 2.0: a learned win-probability correction",
    body: "A small logistic model that adjusts the score-gap probability for match context (where points come from, lopsided alliances, experience, time away, playoffs) and three track-record signals per robot. Replayed over 2025–26, which it never trained on, winner accuracy went from 72.68% to 74.65%.",
    more: `Fitted on 2023–24 and 2024–25, chosen on Jan–Feb 2025, calibrated on Mar–May 2025, frozen before 2025–26 was scored. On ${n0(E2.nonTies)} decided 2025–26 matches (the ${n0(E2.matches)} replayed, less ${n0(E2.matches - E2.nonTies)} ties): +1.98 points (95% range +1.62 to +2.32), Brier 0.1789 → 0.1684, log loss 0.537 → 0.510. Predicted scores are untouched. Costs: 10-bin calibration error rose from 1.02% to 1.26%, May 2026 lost 0.99 points on 810 matches and July 1.71 points on 234, and the gain is smallest for strong favourites (+0.22 points). The track-record signals add only +0.10 points of the gain on their own; most of it comes from the match context.`,
  },
  {
    v: "ship", title: "Order-free population baseline",
    body: "The season's average robot, which newcomers start from, used to depend on which alliance of a match was counted first. Both alliances now count together.",
    more: "A colour swap of a season's first match moved the next newcomer's starting rating from about 97 to 27 points. Now it can't. On 2025–26 win odds were unchanged (accuracy identical, Brier +0.000004) and score error improved slightly (27.874 → 27.864 points). It's a correctness fix, not an accuracy claim.",
  },
  {
    v: "no", title: "Faster rating updates",
    body: "Learning more from each match looked better on early-2025 development data, but it lost accuracy on the season it hadn't seen.",
    more: "On 2025–26: 72.44% vs 72.68% winner accuracy, Brier 0.1802 vs 0.1789, score error 28.12 vs 27.87 points. The existing gains stay.",
  },
  {
    v: "no", title: "Covariance-aware ratings",
    body: "A rating system that tracks how partners' estimates are tied together. It predicted scores better but not winners, and its ranges got too wide.",
    more: "On 2025–26: score error 27.32 vs 27.87 points, but winner accuracy only 72.78% vs 72.68%, nominal 80% ranges covered 87.9%, and its event-level behaviour is untested. Deferred, not shipped.",
  },
  {
    v: "ship", title: "Platt calibration",
    body: "A two-number correction to win probabilities. Calibration error on the test season fell from 0.017 to 0.0105, and accuracy barely moved, because favourites almost always stay favourites.",
    more: "Fitted by maximum likelihood on 2024–25 live predictions: a = 0.937, b = 0.020. On 2025–26, live Brier went from 0.1791 to 0.1789 and pre-event accuracy from 68.65% to 68.78%. The correction keeps predictions in the same order. Its small offset can tip a raw call between about 49.5% and 50% to the other side, which is where that small accuracy change comes from.",
  },
  {
    v: "ship", title: "Fair starting ratings",
    body: "A newcomer on the blue side used to get a slightly different starting rating than one on red, because red's result was counted first. Now both sides see the same starting point.",
    more: "It affects about one match per season replay, so every test metric moved by 0.0002 or less. It's a correctness fix: swapping red and blue now gives mirrored ratings, and a blue newcomer's start no longer depends on red's score.",
  },
  {
    v: "no", title: "Smarter credit splitting",
    body: "Giving more of an alliance's surprise to the robot the engine is less sure about (TrueSkill-style). It sounds clever, but it made predictions worse.",
    more: "On 2025–26, live accuracy dropped 0.25 points and Brier rose from 0.1791 to 0.1806, with worse calibration. The other settings were tuned for equal sharing, and changing the split without a full retune hurt.",
  },
  {
    v: "no", title: "Alliance declines",
    body: "Letting high-ranked teams turn down invitations to captain their own alliance. It fit 2024–25 slightly better but predicted real 2025–26 picks clearly worse.",
    more: "Pick log-likelihood on 2,540 real 2025–26 picks: −5,080 with declines vs −4,952 without. Advancement Brier slipped too (0.1287 → 0.1290 before the event, 0.0855 → 0.0866 after quals). And in playoffs, favourites actually win more often than predicted, so stacked alliances aren't being over-rated.",
  },
  {
    v: "off", wide: true, title: "Robot rebuild detection",
    body: "Teams coming back from a long break are hard to predict, because many have rebuilt. The engine has a mode that grows less certain after a break and learns faster from the next few matches. It does what it says (see below), but after a full refit, the odds of advancing from an event got slightly worse. So it's in the code, switched off, waiting for a better fit. Re-tested on engine 3.2 as a faster-learning bump alone at a team's next meet: it didn't help teams at their 2nd or later meet in any season, and it made playoff predictions worse: what it gains on improved robots, it loses by making every other robot's rating noisier.",
    more: "After a break of 4+ weeks, uncertainty grows by 200 points² per week away and the learning rate resets as if the robot had played 4 matches. On 2025–26, the error on the 2nd–3rd match after 8+ weeks off fell from 33.6 to 32.1 points, and overall score error from 27.95 to 27.88. Win odds were unchanged, but advancement Brier went from 0.1286 to 0.1291, so it stays off. Re-test on 3.2 (October 2026), learning rate only, after 2+ or 3+ weeks away, as if the robot had played 3 or 5 matches; Brier ×10⁻⁴ on the robot's 2nd event, 2023–24 / 2024–25 (tuning) / 2025–26: +2.04 / +0.08 / +2.97 (2+ weeks, 3), +0.13 / −1.26 / +0.46 (2+ weeks, 5), +3.30 / −0.59 / +2.53 (3+ weeks, 3), every interval including zero. All three made 2025–26 playoffs worse beyond noise (+2.5 to +5.0), and the best setting also lost 0.22 points of winner accuracy on second-event matches in 2025–26 [−0.40, −0.05]. Details in docs/engine/part12/rebuild-gain.md.",
  },
];

/** The public repository the lab notes' reports live in. */
export const REPO_URL = "https://github.com/ZOGWORK/control-scout";
/** A report path the notes cite (docs/…), without the sentence's closing full stop. */
const DOC_PATH = /\bdocs\/[A-Za-z0-9_./-]*[A-Za-z0-9_/-]/g;

/** The repository's page for a cited path: a file (with an extension) opens as a file, a folder as a folder. */
export function repoUrl(path: string): string {
  const p = path.replace(/\/+$/, "");
  return `${REPO_URL}/${/\.[A-Za-z0-9]+$/.test(p) ? "blob" : "tree"}/main/${p}`;
}

/** Text with every cited docs/ path as a link to it in the public repository. */
export function RepoLinks({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(DOC_PATH)) {
    out.push(text.slice(last, m.index));
    out.push(<a key={m.index} href={repoUrl(m[0])} target="_blank" rel="noopener noreferrer" className="font-mono text-foreground underline decoration-border underline-offset-2 hover:decoration-current">{m[0]}</a>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

export function Verdicts() {
  return (
    <div className="mx-auto my-8 grid max-w-5xl gap-3 md:grid-cols-2">
      {NOTES.map((n, i) => <Card key={n.title} note={n} delay={i * 0.07} />)}
    </div>
  );
}

function Card({ note, delay }: { note: (typeof NOTES)[number]; delay: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const tag = TAG[note.v];
  return (
    <Reveal delay={delay} className={cn("min-w-0", note.wide && "md:col-span-2")}>
      <article className="grid h-full content-start gap-2 rounded-2xl border border-border bg-card p-4 transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 motion-reduce:transform-none sm:p-5">
        <span className={cn("w-fit rounded-full border border-current px-2 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em]", tag.cls)}>{tag.text}</span>
        <h3 className="font-display text-[1.0625rem] font-semibold text-foreground">{note.title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{note.body}</p>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-border bg-muted/60 px-3 font-mono text-xs font-semibold text-foreground transition-colors hover:bg-muted">
          {open ? "Hide details" : "Details"} <ChevronRight className={cn("size-3.5 transition-transform duration-300", open && "rotate-90")} />
        </button>
        <div id={id} className="hiw-expand" data-open={open ? "" : undefined} aria-hidden={!open} inert={!open}>
          <div><p className="pt-1 text-[0.8438rem] leading-relaxed text-muted-foreground"><RepoLinks text={note.more} /></p></div>
        </div>
      </article>
    </Reveal>
  );
}

export function BreakChart() {
  return (
    <Figure narrow label="Figure 12 · engine research" title="Why rebuilds are hard: score error after a break (2024–25)"
      caption="Alliance score error (MAE, points) on the tuning season, from the engine's research runs. On a robot's first match after two months off, the error is more than 2½ times the usual. A rebuilt robot only shows itself once it plays, so the error stays high for a few matches.">
      <ScrollX label="Score error after a break chart">
        <HBars
          label="Bar chart of mean absolute score error by situation: no recent break 22 points; first match after 2 to 4 weeks off 28; after 4 to 8 weeks 36; after 8 or more weeks 58; second to third match after 8 weeks 45; fourth to sixth 36."
          max={65} fmt={(v) => `${v.toFixed(0)} pts`} ticks={[0, 20, 40, 60]} left={180}
          rows={[
            { label: "No recent break", v: 22.3, tone: "muted", strong: true },
            { label: "1st match, 2–4 wk off", v: 28.4, tone: "gold", dim: true },
            { label: "1st match, 4–8 wk off", v: 36.2, tone: "gold" },
            { label: "1st match, 8+ wk off", v: 57.8, tone: "red", strong: true },
            { label: "2nd–3rd match, 8+ wk", v: 45.3, tone: "red", dim: true },
            { label: "4th–6th match, 8+ wk", v: 36.4, tone: "gold" },
          ].map((r) => ({ ...r, tone: r.tone as "muted" | "gold" | "red", tip: `${r.label}: off by ${r.v.toFixed(1)} pts on average` }))}
        />
      </ScrollX>
    </Figure>
  );
}
