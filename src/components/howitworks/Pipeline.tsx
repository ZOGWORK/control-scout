// Figure 1: the four-stage pipeline. Tap (or Enter/Space on) a stage to open its detail.
import { useState, type ReactNode } from "react";
import { cn } from "../cn";
import { Figure } from "./ui";

const STAGES: { title: string; body: string; out: string; detail: ReactNode }[] = [
  {
    title: "Rate every robot", body: "Every played match nudges each robot's rating for auto, TeleOp, endgame and penalties.", out: "→ a strength per robot",
    detail: <><b>Ratings.</b> Four numbers per robot (auto, TeleOp, endgame, penalties), updated after every played match from the alliance's miss, split equally between the two robots. New this season? The start comes from last season's z-score, or a rookie default.</>,
  },
  {
    title: "Predict a match", body: "Add up each alliance, account for how noisy FTC scores are, compare the two.", out: "→ win %, score range, tier",
    detail: <><b>Match model.</b> Expected alliance score = its robots' non-penalty ratings + the penalties the opponents tend to give away. Spread = 14 + 0.2 × expected, widened by rating uncertainty. P(red wins) starts as the overlap of the two curves; Prediction Engine 2.0 then corrects it for match context and each robot's track record, and calibrates it. Every call also gets a confidence tier.</>,
  },
  {
    title: "Simulate the event", body: "Play the rest of quals, rank teams, pick alliances, run the bracket. Repeat 2,000×.", out: "→ ranks, picks, champions",
    detail: <><b>Event simulation.</b> 2,000 runs. Each run draws every robot's form for the day once, plays the unplayed quals, ranks by the season's RP rules and tiebreakers, picks alliances like real captains, then runs the real double-elimination bracket.</>,
  },
  {
    title: "Apply the rules", body: "Advancement points, awards and slots, skipping teams that already qualified.", out: "→ your odds of advancing",
    detail: <><b>Advancement.</b> 2025–26 points: quals rank (bell-curve formula), alliance selection (21 − alliance number for captain and first pick), playoffs (40/20/10/5) and awards (Inspire 60/30/15, other judged 12/6/3, highest only). Slots go down the list, skipping teams already qualified.</>,
  },
];

export function Pipeline() {
  const [open, setOpen] = useState(-1);
  const toggle = (i: number) => setOpen((o) => (o === i ? -1 : i));
  return (
    <Figure label="Figure 1" title="The prediction pipeline" note="tap a step"
      caption={<>Every number in the app comes out of the end of this chain. The data feeding it is described just below.</>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
        {STAGES.map((s, i) => (
          <button
            key={s.title} type="button" aria-expanded={open === i} aria-controls="hiw-pipe-detail" onClick={() => toggle(i)}
            className={cn(
              "hiw-stage relative grid min-w-0 content-start gap-1.5 rounded-xl border p-3.5 text-left transition-[transform,border-color,background-color] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-1 hover:border-accent motion-reduce:hover:translate-y-0",
              open === i ? "-translate-y-1 border-accent bg-card motion-reduce:translate-y-0" : "border-border bg-muted/50",
            )}
          >
            <span className="hiw-gold font-display text-3xl font-bold leading-none">{i + 1}</span>
            <b className="font-display text-[0.9375rem] font-semibold text-foreground">{s.title}</b>
            <span className="text-sm leading-snug text-muted-foreground">{s.body}</span>
            <span className="mt-1 border-t border-dashed border-border pt-2 font-mono text-[11.5px] text-foreground">{s.out}</span>
          </button>
        ))}
      </div>
      <div id="hiw-pipe-detail" className="hiw-expand mt-3" data-open={open >= 0 ? "" : undefined} aria-live="polite">
        <div>
          {open >= 0 && <p className="border-t border-border pt-3 text-[0.9375rem] leading-relaxed text-foreground/85 [&_b]:font-display [&_b]:text-foreground">{STAGES[open].detail}</p>}
        </div>
      </div>
    </Figure>
  );
}
