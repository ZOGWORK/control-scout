// How it works: the hub. One section per part of the site that has its own
// explainer (predictions at /methodology, FTC One Search at
// /how-it-works/search). A section opens in place to a summary, a small
// figure and its key numbers; only its link leaves the hub. Built from the
// prediction page's own parts (src/components/howitworks/), so the two read
// and move alike.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown, Search, Sparkles } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { useTitle } from "../lib/meta";
import { cn } from "../components/cn";
import { m } from "../components/motion";
import "../components/howitworks/howitworks.css";
import { CountUp, Eyebrow, Kpi, Reveal, TipLayer, useReduced } from "../components/howitworks/ui";
import { MODEL } from "../components/howitworks/math";
import { FORECAST_RUNS } from "../shared/projections";
import { SEARCH_STEPS, SEARCH_FAMILIES } from "../components/howitworks/searchDocs";

const ease = [0.2, 0.8, 0.2, 1] as const;

interface Part {
  id: string;
  icon: typeof Sparkles;
  title: string;
  line: string;
  summary: ReactNode;
  steps: string[];
  kpis: { value: ReactNode; label: string; tone?: "gold" }[];
  to: string;
  cta: string;
}

const tested = (MODEL.accuracy as { matches: { count: number } }).matches.count;

const PARTS: Part[] = [
  {
    id: "predictions", icon: Sparkles, title: "Predictions",
    line: "How the engine rates every robot, calls each match and plays out whole events.",
    summary: <>Every robot carries a rating for auto, TeleOp, endgame and penalties, updated after each played match. Two alliances' ratings become a win chance and a likely score; whole events are played out thousands of times to get ranks, picks and advancement odds. Every call is scored after the match, and the record is public.</>,
    steps: ["Rate every robot", "Predict a match", "Simulate the event", "Apply the rules"],
    kpis: [
      { value: <CountUp value={tested} />, label: "matches it was tested on, never seen in tuning", tone: "gold" },
      { value: <CountUp value={FORECAST_RUNS} />, label: "simulated runs per event forecast" },
      { value: `v${ENGINE_VERSION}`, label: "engine version, shared with Control Point" },
    ],
    to: "/methodology", cta: "How predictions work",
  },
  {
    id: "search", icon: Search, title: "FTC One Search",
    line: "What you can search for, and how fixed rules (no AI) turn what you type into an answer.",
    summary: <>Type a team, event, match, place or question. FTC One Search tidies the words, checks a fixed list of question shapes in order (who won, how many, best, versus, rules, an event's matches and more), then looks up teams, events and matches. The first rule that fits answers; if nothing matches exactly, it says so and shows the closest matches, labelled as such.</>,
    steps: SEARCH_STEPS.map((s) => s.title),
    kpis: [
      { value: <CountUp value={SEARCH_STEPS.length} />, label: "steps, always run in the same order", tone: "gold" },
      { value: <CountUp value={SEARCH_FAMILIES.length} />, label: "kinds of answers it can give" },
      { value: "0", label: "AI models in the search path" },
    ],
    to: "/how-it-works/search", cta: "How FTC One Search works",
  },
];

const WORDS: { w: string; gold?: boolean }[] = [{ w: "How" }, { w: "Control" }, { w: "Scout" }, { w: "works", gold: true }];

export default function HowItWorksPage() {
  useTitle("How it works");
  const reduced = useReduced();
  // A link to /how-it-works#search opens that section.
  const [open, setOpen] = useState<string | null>(() => (typeof location !== "undefined" ? PARTS.find((p) => `#${p.id}` === location.hash)?.id ?? null : null));
  useEffect(() => {
    const onHash = () => { const id = PARTS.find((p) => `#${p.id}` === location.hash)?.id; if (id) setOpen(id); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <TipLayer>
      <div className={cn("hiw", !reduced && "hiw-anim")}>
        <header className="grid gap-5 max-sm:gap-4 pb-8">
          <Eyebrow>Control Scout · What you can do, explained</Eyebrow>
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
            className="max-w-2xl text-lg leading-relaxed text-foreground/85 sm:text-xl"
            initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.4 }}
          >
            The two parts of Control Scout that do the most behind the scenes, in plain language. Open one for the short version; each has a full page with the details and the real numbers.
          </m.p>
        </header>

        <div className="mx-auto grid max-w-5xl gap-4">
          {PARTS.map((p, i) => (
            <Section key={p.id} part={p} num={i + 1} open={open === p.id} onToggle={() => setOpen((o) => (o === p.id ? null : p.id))} />
          ))}
        </div>

        <Reveal className="mx-auto mt-10 max-w-2xl">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Looking for something else? The <Link to="/faq" className="text-foreground underline decoration-accent underline-offset-2">FAQ</Link> answers questions about data, accounts, scouting and offline use.
          </p>
        </Reveal>
      </div>
    </TipLayer>
  );
}

function Section({ part: p, num, open, onToggle }: { part: Part; num: number; open: boolean; onToggle: () => void }) {
  const Icon = p.icon;
  const body = `hiw-hub-${p.id}`;
  const glow = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Reveal delay={num * 0.08}>
      <section id={p.id} onPointerMove={glow} data-seen={open ? "" : undefined} className={cn("hiw-panel scroll-mt-bar-20 overflow-hidden rounded-2xl border bg-card transition-colors duration-300", open ? "border-accent" : "border-border")}>
        <h2 className="m-0">
          <button type="button" aria-expanded={open} aria-controls={body} onClick={onToggle} className="flex w-full items-center gap-4 p-4 text-left sm:p-5">
            <span className="hiw-gold font-display text-3xl font-bold leading-none tabular-nums sm:text-4xl">{String(num).padStart(2, "0")}</span>
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl border transition-colors duration-300", open ? "border-accent bg-accent text-accent-ink" : "border-border bg-muted/60 text-foreground")}>
              <Icon className="size-5" />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-display text-lg font-semibold text-foreground sm:text-xl">{p.title}</span>
              <span className="text-sm leading-snug text-muted-foreground">{p.line}</span>
            </span>
            <ChevronDown aria-hidden className={cn("size-5 shrink-0 text-muted-foreground transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none", open && "rotate-180 text-foreground")} />
          </button>
        </h2>
        <div id={body} role="region" aria-label={p.title} className="hiw-expand" data-open={open ? "" : undefined}>
          <div>
            <div className="grid gap-5 border-t border-border p-4 sm:p-5" inert={!open}>
              <p className="max-w-3xl text-[0.9375rem] leading-[1.75] text-foreground/85 sm:text-base">{p.summary}</p>
              <ol className={cn("grid grid-cols-1 gap-2.5 sm:grid-cols-2", p.steps.length > 4 ? "hiw-steps-wrap lg:grid-cols-6" : "md:grid-cols-4")} aria-label={`${p.title}, step by step`}>
                {p.steps.map((s, i) => (
                  <li key={s} className="hiw-stage pop relative grid content-start gap-1 rounded-xl border border-border bg-muted/50 p-3" style={{ ["--i" as string]: i }}>
                    <span className="hiw-gold font-display text-xl font-bold leading-none">{i + 1}</span>
                    <span className="font-display text-sm font-semibold text-foreground">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                {p.kpis.map((k) => <Kpi key={k.label} value={k.value} label={k.label} tone={k.tone} />)}
              </div>
              <Link to={p.to} className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg bg-accent px-4 font-display text-sm font-semibold text-accent-ink transition-transform hover:-translate-y-0.5 motion-reduce:hover:translate-y-0">
                {p.cta} <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </Reveal>
  );
}
