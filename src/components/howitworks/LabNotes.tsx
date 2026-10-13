// Section 06: lab notes. What was tried on the shared engine, and what made the cut.
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../cn";
import { HBars } from "./charts";
import { Figure, Reveal, ScrollX } from "./ui";

type Verdict = "ship" | "no" | "off";
const TAG: Record<Verdict, { text: string; cls: string }> = {
  ship: { text: "Shipped", cls: "text-success" },
  no: { text: "Rejected", cls: "text-red-alliance" },
  off: { text: "Built, switched off", cls: "hiw-gold" },
};

const NOTES: { v: Verdict; title: string; body: string; more: string; wide?: boolean }[] = [
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
    body: "Teams coming back from a long break are hard to predict, because many have rebuilt. The engine has a mode that grows less certain after a break and learns faster from the next few matches. It does what it says (see below), but after a full refit, the odds of advancing from an event got slightly worse. So it's in the code, switched off, waiting for a better fit.",
    more: "After a break of 4+ weeks, uncertainty grows by 200 points² per week away and the learning rate resets as if the robot had played 4 matches. On 2025–26, the error on the 2nd–3rd match after 8+ weeks off fell from 33.6 to 32.1 points, and overall score error from 27.95 to 27.88. Win odds were unchanged, but advancement Brier went from 0.1286 to 0.1291, so it stays off.",
  },
];

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
        <h3 className="font-display text-[17px] font-semibold text-foreground">{note.title}</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">{note.body}</p>
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
          className="inline-flex min-h-9 w-fit items-center gap-1 rounded-lg border border-border bg-muted/60 px-3 font-mono text-xs font-semibold text-foreground transition-colors hover:bg-muted">
          {open ? "Hide details" : "Details"} <ChevronRight className={cn("size-3.5 transition-transform duration-300", open && "rotate-90")} />
        </button>
        <div id={id} className="hiw-expand" data-open={open ? "" : undefined} aria-hidden={!open}>
          <div><p className="pt-1 text-[13.5px] leading-relaxed text-muted-foreground">{note.more}</p></div>
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
