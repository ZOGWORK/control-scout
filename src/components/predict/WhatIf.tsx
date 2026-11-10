// What if: one robot of a predicted match swapped for another (a different partner, a different opponent), and the
// call and margin before and after, side by side. The swap is in the address (?whatif=OLD:NEW), so a what-if can be
// shared and Back undoes it. Both calls come from the same /api/predict/match the lab uses: nothing is estimated here.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, FlaskConical, Undo2 } from "lucide-react";
import { useApi, qs } from "../../lib/api";
import { oddsPct } from "../../lib/format";
import { lookupTeamName, TeamInput } from "../TeamInput";
import { teamsErrors } from "../../lib/teamCheck";
import { Button } from "../ui/button";
import { WinBar } from "../predict";
import { cn } from "../cn";
import { marginWords } from "../../shared/predictionBasis";
import { predictHref } from "../../shared/predictUrl";
import type { MatchExplanationView } from "../../shared/api";

/** ?whatif=OLD:NEW, when OLD is in the line-up and NEW isn't. */
export function readWhatIf(v: string | null, lineUp: number[]): { out: number; in: number } | null {
  const m = /^(\d+):(\d+)$/.exec(v ?? "");
  if (!m) return null;
  const out = Number(m[1]), into = Number(m[2]);
  return lineUp.includes(out) && !lineUp.includes(into) && into > 0 ? { out, in: into } : null;
}

/** The side with one robot swapped. */
export const swapped = (side: number[], out: number, into: number) => side.map((t) => (t === out ? into : t));

/** A win chance as the rows show it (oddsPct: 1% to 99%), so the Change line adds up from the two rows. */
const shownPct = (p: number) => Math.min(99, Math.max(1, Math.round(100 * p)));

/** Red's predicted margin in points (negative: Blue ahead), from the shown scores. */
const margin = (x: MatchExplanationView) => Math.round(x.predictedRed) - Math.round(x.predictedBlue);

export function WhatIf({ base }: { base: MatchExplanationView }) {
  const [sp, setSp] = useSearchParams();
  const lineUp = [...base.red, ...base.blue];
  const key = lineUp.join(",");
  const swap = readWhatIf(sp.get("whatif"), lineUp);
  const [out, setOut] = useState<number>(swap?.out ?? lineUp[0]);
  const [into, setInto] = useState(swap ? String(swap.in) : "");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // A new base matchup (or Back) moves the picker to the swap in the address, or to the first robot.
  useEffect(() => { setOut(swap?.out ?? lineUp[0]); setInto(swap ? String(swap.in) : ""); setError(null); }, [key, swap?.out, swap?.in]); // eslint-disable-line react-hooks/exhaustive-deps
  const red = swap ? swapped(base.red, swap.out, swap.in) : base.red, blue = swap ? swapped(base.blue, swap.out, swap.in) : base.blue;
  const after = useApi<MatchExplanationView>(swap ? `/api/predict/match${qs({ season: base.season, red: red.join(","), blue: blue.join(","), ...(base.level === "playoff" ? { level: "playoff" } : {}) })}` : null);
  const set = (v: string | null) => setSp((x) => { if (v) x.set("whatif", v); else x.delete("whatif"); return x; });
  // The check in flight: any edit, pick, Undo, new matchup or leaving the page clears it, and a check that finishes
  // after that is dropped (never writes an old swap over a newer choice).
  const asked = useRef("");
  useEffect(() => () => { asked.current = ""; }, []);
  const run = async () => {
    const n = Number(into.trim());
    if (lineUp.includes(n)) { setError(`${n} is already in this match. Pick a robot that isn't.`); return; }
    const at = (asked.current = `${key}|${out}|${n}`);
    setChecking(true);
    const [e] = await teamsErrors([into], ["the new robot"], lookupTeamName);
    setChecking(false);
    if (asked.current !== at) return;
    if (e) { setError(e); return; }
    set(`${out}:${n}`);
  };
  useEffect(() => { asked.current = ""; }, [key, sp.get("whatif")]);
  // Arrow keys move the pick along the robots, as a radio group does; only the picked one is a tab stop.
  const pickKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + lineUp.length) % lineUp.length;
    setOut(lineUp[j]); setError(null); asked.current = "";
    (e.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
  };
  const side = (t: number) => (base.red.includes(t) ? "red" : "blue");
  return (
    <section id="what-if" aria-labelledby="what-if-title" data-testid="what-if" className="rounded-2xl border border-border bg-card p-5 max-sm:p-4">
      <h2 id="what-if-title" className="flex items-center gap-2 text-base font-semibold"><FlaskConical className="size-4 text-accent" aria-hidden /> What if?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Swap one robot for another, a different partner or opponent, and see how the call and the margin move. Same ratings, same engine.</p>
      <form onSubmit={(e) => { e.preventDefault(); run(); }} noValidate className="mt-3 flex flex-wrap items-end gap-3">
        <div role="radiogroup" aria-label="Robot to swap out" className="flex flex-wrap gap-1.5">
          {lineUp.map((t, i) => (
            <button key={t} type="button" role="radio" aria-checked={out === t} tabIndex={out === t ? 0 : -1} onKeyDown={(e) => pickKey(e, i)} onClick={() => { setOut(t); setError(null); asked.current = ""; }}
              className={cn("h-11 rounded-lg border px-3 font-mono text-sm tabular-nums transition-colors motion-reduce:transition-none",
                out === t ? (side(t) === "red" ? "border-red-alliance bg-red-alliance/10 text-red-alliance" : "border-blue-alliance bg-blue-alliance/10 text-blue-alliance") : "border-border text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
        <ArrowRight className="mb-3.5 size-4 text-muted-foreground max-sm:hidden" aria-hidden />
        <div className="w-44 max-sm:w-full"><TeamInput label={`Instead of ${out}`} tone={side(out)} value={into} onChange={(v) => { setInto(v); setError(null); asked.current = ""; }} error={error} /></div>
        <Button type="submit" disabled={!into.trim() || checking} className="h-11">Try it</Button>
        {swap && <Button type="button" variant="ghost" onClick={() => { asked.current = ""; set(null); }} className="h-11"><Undo2 /> Undo</Button>}
      </form>
      {swap && (after.error ? <p role="alert" className="mt-3 text-sm text-destructive">{after.error.message}</p>
        : !after.data ? <div className="skeleton mt-4 h-28 rounded-xl" />
        : <WhatIfResult before={base} after={after.data} swap={swap} />)}
    </section>
  );
}

function WhatIfResult({ before, after, swap }: { before: MatchExplanationView; after: MatchExplanationView; swap: { out: number; in: number } }) {
  const dp = shownPct(after.winProbRed) - shownPct(before.winProbRed);
  const dm = margin(after) - margin(before);
  const row = (label: string, x: MatchExplanationView, testid: string) => (
    <div data-testid={testid} className="grid grid-cols-[6rem_1fr] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div>
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm tabular-nums">
          <span><span className="text-red-alliance">Red {x.red.join(" + ")}</span> <b className="font-display text-lg text-red-alliance">{oddsPct(x.winProbRed)}</b></span>
          <span className="text-muted-foreground">{marginWords(x.predictedRed, x.predictedBlue)} ({Math.round(x.predictedRed)}–{Math.round(x.predictedBlue)})</span>
          <span><b className="font-display text-lg text-blue-alliance">{oddsPct(x.winProbBlue)}</b> <span className="text-blue-alliance">Blue {x.blue.join(" + ")}</span></span>
        </p>
        <WinBar pRed={x.winProbRed} size="sm" className="mt-1" />
      </div>
    </div>
  );
  return (
    <div className="mt-4 space-y-3" data-testid="what-if-result">
      {row("As picked", before, "what-if-before")}
      {row(`${swap.out} → ${swap.in}`, after, "what-if-after")}
      <p className="text-sm" data-testid="what-if-change">
        <b className="font-semibold">Change:</b> Red's chance {dp === 0 ? "stays the same" : `${dp > 0 ? "rises" : "falls"} ${Math.abs(dp)} points`}, and the margin {dm === 0 ? "doesn't move" : `moves ${Math.abs(dm)} toward ${dm > 0 ? "Red" : "Blue"}`}.
        {" "}<Link to={predictHref({ mode: "match", season: after.season, red: after.red, blue: after.blue })} className="underline">Open this line-up</Link>
      </p>
    </div>
  );
}
