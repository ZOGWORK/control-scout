// The Compare brief: the comparison in plain sentences, each linked to the events or matches behind it.
// Closed by default so the table and charts stay first; ?brief=1 opens it, so an open brief can be shared.
import { useId, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, Copy, FileText } from "lucide-react";
import type { CompareView } from "../shared/api";
import { BRIEF, briefText, compareBrief, type BriefSentence } from "../lib/compareBrief";
import { copyText } from "../lib/clipboard";
import { Button } from "./ui/button";
import { Reveal } from "./motion";
import { cn } from "./cn";

const DOT: Record<BriefSentence["kind"], string> = { fact: "bg-accent", thin: "bg-warning", missing: "bg-muted-foreground/60" };

export function CompareBrief({ d }: { d: CompareView }) {
  const [sp, setSp] = useSearchParams();
  const open = sp.get("brief") === "1";
  const panel = useId();
  const sentences = useMemo(() => compareBrief(d), [d]);
  const toggle = () => setSp((x) => { if (open) x.delete("brief"); else x.set("brief", "1"); return x; }, { replace: true });
  const copy = () => copyText(briefText(d, sentences, location.origin), "Brief copied", "Couldn't copy the brief");
  return (
    <Reveal className="rounded-2xl border border-border bg-card">
      <section aria-labelledby={`${panel}-title`}>
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15"><FileText className="size-4 text-accent" aria-hidden /></span>
            <div className="min-w-0">
              <h2 id={`${panel}-title`} className="text-sm font-semibold">Brief</h2>
              <p className="text-xs text-muted-foreground">The comparison in short sentences, each linked to its source</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {open && <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={copy}><Copy /> Copy brief</Button>}
            <Button variant="secondary" size="sm" className="max-sm:h-10" aria-expanded={open} aria-controls={panel} onClick={toggle}>
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? "Hide brief" : "Show brief"}
            </Button>
          </div>
        </div>
        {open && (
          <div id={panel} className="border-t border-border px-4 pb-4 pt-3">
            <ul className="space-y-3">
              {sentences.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-sm" data-kind={s.kind}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[s.kind])} aria-hidden />
                  <div className="min-w-0">
                    <p><span className="font-semibold">{s.topic}:</span> {s.text}</p>
                    {s.sources.length > 0 && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span>Source{s.sources.length > 1 ? "s" : ""}: </span>
                        {s.sources.map((x, j) => (
                          <span key={x.href + j}>{j > 0 && ", "}<Link to={x.href} className="text-accent-text underline-offset-2 hover:underline">{x.label}</Link></span>
                        ))}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
              Built from the numbers above, by fixed rules: teams with fewer than {BRIEF.minMatches} matches aren't compared, gaps under {BRIEF.levelPoints} point
              count as level, and OPR is each team's best event this season. It describes results only; it uses no predictions.
            </p>
          </div>
        )}
      </section>
    </Reveal>
  );
}
