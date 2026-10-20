// Section 03 figures: the two score curves and the win-probability playground.
import { useEffect, useRef, useState } from "react";
import { cn } from "../cn";
import { Bells } from "./charts";
import { CERTAINTY, NOISE, sigma, winProb, type Certainty } from "./math";
import { Chart, Figure, Note, ScrollX, Seg, Slider, useReduced } from "./ui";

export function BellFigure() {
  const unc = 2 * CERTAINTY.well;
  const sR = sigma(145, unc), sB = sigma(120, unc);
  const p = winProb(145, 120, unc);
  return (
    <Figure label="Figure 5" title="Two score curves, one win probability"
      caption="The 25-point gap is real, but the curves overlap a lot, so red wins about two times in three. The shaded bands are the 80% ranges shown in the app; in the engine's held-out test, real scores landed inside them 82% of the time.">
      <ScrollX label="Score curves chart" min={560}>
        <Chart viewBox="0 0 900 300" label={`Two overlapping bell curves: red centred at 145 points, blue at 120 points. Red wins about ${Math.round(p * 100)}% of the time.`} interactive>
          <Bells muR={145} muB={120} sR={sR} sB={sB} L={40} R={860} T={24} B={250} />
          <text x={860} y={40} textAnchor="end" className="t-ink t-big">P(red wins) = {Math.round(p * 100)}%</text>
        </Chart>
      </ScrollX>
      <Legend items={[["var(--hiw-red)", "Red · expected 145"], ["var(--hiw-blue)", "Blue · expected 120"], ["color-mix(in srgb, var(--hiw-muted) 35%, transparent)", "Shaded: 80% score range"]]} />
    </Figure>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-xs text-muted-foreground">
      {items.map(([c, t]) => <span key={t} className="inline-flex items-center gap-1.5"><i aria-hidden className="inline-block size-3 rounded-[2px]" style={{ background: c }} />{t}</span>)}
    </div>
  );
}

interface Curves { muR: number; muB: number; sR: number; sB: number }

export function Playground() {
  const reduced = useReduced();
  const [red, setRed] = useState(145);
  const [blue, setBlue] = useState(120);
  const [cert, setCert] = useState<Certainty>("well");
  const unc = 2 * CERTAINTY[cert];
  const target: Curves = { muR: red, muB: blue, sR: sigma(red, unc), sB: sigma(blue, unc) };

  // Sliders move instantly; changing certainty tweens the curves' width.
  const [cur, setCur] = useState<Curves>(target);
  const curRef = useRef(cur);
  const raf = useRef(0);
  const lastCert = useRef(cert);
  useEffect(() => {
    cancelAnimationFrame(raf.current);
    const certChanged = lastCert.current !== cert;
    lastCert.current = cert;
    if (!certChanged || reduced) { curRef.current = target; setCur(target); return; }
    const from = curRef.current, t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 420), e = 1 - Math.pow(1 - k, 3);
      const v = { muR: from.muR + (target.muR - from.muR) * e, muB: from.muB + (target.muB - from.muB) * e, sR: from.sR + (target.sR - from.sR) * e, sB: from.sB + (target.sB - from.sB) * e };
      curRef.current = v; setCur(v);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [red, blue, cert, reduced]);

  const p = winProb(red, blue, unc);
  const pc = Math.round(p * 100);
  return (
    <Figure label="Interactive" title="Win-probability playground"
      caption={<>This uses the same formula as the app: σ = {NOISE.a} + {NOISE.b} × expected, plus rating uncertainty, then Platt scaling. "Well known" adds {CERTAINTY.well} points² per robot, "First match" {CERTAINTY.new}, and "Before the event" {CERTAINTY.pre - NOISE.preExtra} plus the extra {NOISE.preExtra} that event-start predictions carry, because a team's level moves during an event.</>}>
      <div className="grid items-center gap-6 max-sm:gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid min-w-0 gap-4">
          <Slider id="hiw-red" label="Red expected score" value={red} display={String(red)} min={20} max={300} step={1} onChange={setRed} />
          <Slider id="hiw-blue" label="Blue expected score" value={blue} display={String(blue)} min={20} max={300} step={1} onChange={setBlue} />
          <div className="grid gap-1.5">
            <Note>How well the engine knows these robots</Note>
            <Seg label="Rating certainty" value={cert} onChange={setCert} options={[{ value: "well", label: "Well known" }, { value: "new", label: "First match" }, { value: "pre", label: "Before the event" }]} />
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5" aria-live="polite">
            <span className={cn("font-display text-5xl font-bold leading-none tabular-nums transition-colors", p >= 0.5 ? "text-red-alliance" : "text-blue-alliance")}>{p >= 0.5 ? pc : 100 - pc}%</span>
            <span className="font-display text-[0.9375rem] font-semibold text-muted-foreground">chance {p >= 0.5 ? "red" : "blue"} wins</span>
          </div>
          <Note>σ red {target.sR.toFixed(1)} · σ blue {target.sB.toFixed(1)} · calibrated</Note>
        </div>
        <ScrollX label="Playground chart" min={420}>
          <Chart viewBox="0 0 520 220" label={`Live chart of the two score curves: red expected ${red}, blue expected ${blue}.`} interactive>
            <Bells {...cur} L={20} R={500} T={18} B={180} xmin={0} xmax={360} />
          </Chart>
        </ScrollX>
      </div>
    </Figure>
  );
}
