// Section 02 figures: rating chips, the worked update, the gain curve,
// "watch a rating learn" and the season carry-over.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Play, RotateCcw, Shuffle } from "lucide-react";
import { Button } from "../ui/button";
import { Chart, CountUp, Figure, Kpi, Note, ScrollX, Seg, Slider, useReduced, useTip } from "./ui";
import { RATING, carryZ, fmtZ, gain, gauss, learnSeries, ratingUpdate, rng } from "./math";

// ---------- Figure 2: one robot's rating ----------

const CHIPS = [
  { k: "Auto", v: 18.4, d: "points in the 30 s autonomous period" },
  { k: "TeleOp", v: 41.2, d: "driver-controlled, not counting endgame" },
  { k: "Endgame", v: 12.9, d: "parking, climbing, the last seconds" },
  { k: "Penalties", v: 3.1, d: <>points it tends to give the <em>other</em> alliance</>, pen: true },
];

export function RatingChips() {
  return (
    <Figure narrow label="Figure 2" title="One robot's rating (example)"
      caption="Strength (the non-penalty part) is 18.4 + 41.2 + 12.9 = 72.5 points. Penalties are kept apart because they score for the opponent.">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {CHIPS.map((c) => (
          <div key={c.k} className="min-w-0 rounded-xl border border-border bg-muted/50 p-3 transition-transform duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] hover:-translate-y-0.5 hover:-rotate-[.4deg] motion-reduce:transform-none">
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{c.k}</div>
            <div className={`font-display text-3xl font-bold leading-tight tabular-nums ${c.pen ? "text-red-alliance" : "text-foreground"}`}><CountUp value={c.v} decimals={1} /></div>
            <div className="text-[13px] leading-snug text-muted-foreground">{c.d}</div>
          </div>
        ))}
      </div>
    </Figure>
  );
}

// ---------- worked update ----------

export function WorkedUpdate() {
  const u = ratingUpdate(145, 165, 2); // the engine counts matches already played: a 3rd match has 2 before it
  return (
    // A Tab stop (with a name) so a keyboard can scroll it sideways on a phone, where it's wider than the screen.
    <div role="region" tabIndex={0} aria-label="Worked example of a rating update" className="custom-scrollbar overflow-x-auto whitespace-nowrap rounded-xl border outline-none focus-visible:ring-2 focus-visible:ring-ring/60 border-border bg-card px-4 py-3 font-mono text-[13px] leading-[1.95] text-foreground/90">
      Red expected 145, scored 165 → miss = <b>+{u.miss}</b><br />
      each robot's share = {u.miss} ÷ 2 = <b>+{u.share}</b><br />
      robot on its 3rd match (2 played before): gain = {RATING.k0} ÷ (1 + 2/{RATING.n0}) = <b>{u.gain.toFixed(2)}</b><br />
      rating moves by {u.gain.toFixed(2)} × {u.share} = <span className="rounded bg-accent px-1 text-accent-ink">+{u.move.toFixed(1)} points</span>
    </div>
  );
}

// ---------- Figure 3: gain curve ----------

export function GainChart() {
  const L = 50, R = 610, T = 16, B = 210;
  const x = (n: number) => L + (n / 30) * (R - L), y = (k: number) => B - (k / 0.7) * (B - T);
  const [n, setN] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  let d = "";
  for (let i = 0; i <= 30; i += 0.25) d += `${i ? "L" : "M"}${x(i).toFixed(1)},${y(gain(i)).toFixed(1)}`;
  const fromPointer = (e: PointerEvent<SVGRectElement>) => {
    const svg = svgRef.current?.closest("svg") ?? svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    setN(Math.round(Math.max(0, Math.min(30, ((pt.x - L) / (R - L)) * 30))));
  };
  const key = (e: KeyboardEvent<SVGRectElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); setN((v) => Math.min(30, (v ?? -1) + 1)); }
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); setN((v) => Math.max(0, (v ?? 1) - 1)); }
  };
  const k = n == null ? null : gain(n);
  const floor = RATING.kMin;
  return (
    <Figure narrow label="Figure 3" title="Gain vs. matches played this season" note="hover, tap or arrow keys"
      caption={<>gain = max({floor}, {RATING.k0} ÷ (1 + n/{RATING.n0})). Playoff matches count {RATING.playoffWeight === 0.5 ? "half" : `×${RATING.playoffWeight}`}, because teams play differently in eliminations (defence, strategy, different partners).</>}>
      <ScrollX label="Gain chart">
        <svg ref={svgRef} viewBox="0 0 640 250" role="group" aria-label={`Line chart: gain starts at ${RATING.k0} for a first match, falls to ${floor} by about the tenth match, and stays at that floor.`} className="hiw-chart">
          {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((v) => (
            <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v.toFixed(1)}</text></g>
          ))}
          {[0, 5, 10, 15, 20, 25, 30].map((v) => <text key={v} x={x(v)} y={B + 18} textAnchor="middle">{v}</text>)}
          <text x={(L + R) / 2} y={B + 36} textAnchor="middle">matches played this season</text>
          <line x1={L} x2={R} y1={y(floor)} y2={y(floor)} stroke="var(--hiw-muted)" strokeDasharray="4 4" />
          <text x={R} y={y(floor) - 7} textAnchor="end">floor {floor}</text>
          <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth={3.5} strokeLinejoin="round" pathLength={1} className="draw" />
          {n != null && k != null && (
            <g pointerEvents="none">
              <line x1={x(n)} x2={x(n)} y1={T} y2={B} stroke="var(--hiw-ink)" opacity={0.35} />
              <circle cx={x(n)} cy={y(k)} r={6} fill="var(--hiw-ink)" />
              <text x={x(n) + (n > 20 ? -10 : 10)} y={y(k) - 12} textAnchor={n > 20 ? "end" : "start"} className="t-ink">match {n + 1}: gain {k.toFixed(2)}</text>
            </g>
          )}
          <rect
            x={L} y={T} width={R - L} height={B - T} fill="transparent" tabIndex={0} role="slider"
            aria-label="Matches already played" aria-valuemin={0} aria-valuemax={30} aria-valuenow={n ?? 0}
            aria-valuetext={k == null ? "Move along the curve" : `match ${(n ?? 0) + 1}: gain ${k.toFixed(2)}`}
            style={{ touchAction: "pan-y", outline: "none" }}
            onPointerMove={fromPointer} onPointerDown={fromPointer} onPointerLeave={(e) => { if (e.pointerType === "mouse") setN(null); }}
            onFocus={() => setN((v) => v ?? 3)} onBlur={() => setN(null)} onKeyDown={key}
          />
        </svg>
      </ScrollX>
    </Figure>
  );
}

// ---------- Interactive: watch a rating learn ----------

const N = 20, YMAX = 150;
const makeLuck = (rand: () => number) => Array.from({ length: N }, () => gauss(rand) * 22);

export function LearnSim() {
  const reduced = useReduced();
  const tip = useTip();
  const rand = useRef(rng(7));
  const [luck, setLuck] = useState(() => makeLuck(rand.current));
  const [real, setReal] = useState(85);
  const [start, setStart] = useState<"55" | "35">("55");
  const [upto, setUpto] = useState(N);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const play = () => {
    cancelAnimationFrame(raf.current);
    setPlayed(true);
    if (reduced) { setUpto(N); return; }
    setPlaying(true); setUpto(0);
    let last = 0, frame = 0;
    const tick = (t: number) => {
      if (t - last > 180) { last = t; frame++; setUpto(frame); }
      if (frame < N) raf.current = requestAnimationFrame(tick); else setPlaying(false);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const newLuck = () => { cancelAnimationFrame(raf.current); setLuck(makeLuck(rand.current)); play(); };

  const L = 44, R = 505, T = 14, B = 222;
  const x = (i: number) => L + (i / N) * (R - L), y = (v: number) => B - (Math.max(0, Math.min(YMAX, v)) / YMAX) * (B - T);
  const fast = learnSeries(real, +start, luck, (i) => gain(i));
  const slow = learnSeries(real, +start, luck, () => RATING.kMin);
  const path = (s: number[]) => s.slice(0, upto + 1).map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");

  return (
    <Figure label="Interactive" title="Watch a rating learn"
      actions={<>
        <Button size="sm" onClick={play} disabled={playing}>{played ? <RotateCcw /> : <Play />}{played ? "Replay" : "Play a season"}</Button>
        <Button size="sm" variant="secondary" onClick={newLuck}><Shuffle /> New luck</Button>
      </>}
      caption="Fast at first, steady later. A high early gain gets a new team close to its real level within a handful of matches. The floor keeps the rating moving if the robot really does change.">
      <div className="grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid min-w-0 gap-4">
          <Slider id="hiw-learn-real" label="The robot's real strength" value={real} display={`${real} pts`} min={30} max={130} step={1} onChange={setReal} />
          <div className="grid gap-1.5">
            <Note>Where the rating starts</Note>
            <Seg label="Starting point" value={start} onChange={setStart} options={[{ value: "55", label: "Average team (55)" }, { value: "35", label: "Rookie guess (35)" }]} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Kpi value={upto} label="matches played" />
            <Kpi value={Math.round(fast[upto])} label="the rating" tone="red" />
            <Kpi value={gain(upto).toFixed(2)} label="current gain" />
          </div>
          <Note>Each match shows the robot's share of a noisy alliance score (± about 22 pts, as in real FTC). The faint line is the same robot rated with a fixed, cautious gain of {RATING.kMin}.</Note>
        </div>
        <ScrollX label="Rating chart" min={420}>
          <Chart viewBox="0 0 520 260" label={`Chart of a rating converging toward the robot's real strength (${real}) over ${N} matches.`} interactive>
            {[0, 30, 60, 90, 120, 150].map((v) => <g key={v}><line x1={L} x2={R} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
            {[0, 5, 10, 15, 20].map((v) => <text key={v} x={x(v)} y={B + 18} textAnchor="middle">{v}</text>)}
            <text x={(L + R) / 2} y={B + 34} textAnchor="middle">matches played</text>
            <line x1={L} x2={R} y1={y(real)} y2={y(real)} stroke="var(--hiw-gold)" strokeWidth={2} strokeDasharray="6 5" />
            <text x={L + 8} y={real > 120 ? y(real) + 16 : y(real) - 8} className="t-gold">real strength {real}</text>
            {luck.slice(0, upto).map((o, i) => (
              <circle key={i} cx={x(i + 1)} cy={y(real + o)} r={3.5} fill="var(--hiw-muted)" opacity={0.6} {...tip(`match ${i + 1}: this robot's share looked like ${Math.round(real + o)} pts`)} />
            ))}
            <path d={path(slow)} fill="none" stroke="var(--hiw-muted)" strokeWidth={2} opacity={0.45} />
            <path d={path(fast)} fill="none" stroke="var(--hiw-red)" strokeWidth={3} strokeLinejoin="round" />
            <circle cx={x(upto)} cy={y(fast[upto])} r={6} fill="var(--hiw-red)" stroke="var(--color-card)" strokeWidth={2} />
          </Chart>
        </ScrollX>
      </div>
    </Figure>
  );
}

// ---------- Figure 4: carry-over ----------

export function CarryOver() {
  const [z1, setZ1] = useState(1.5);
  const [z2, setZ2] = useState(1.0);
  const s = carryZ(z1, z2);
  const L = 40, R = 600, mid = 82;
  const x = (z: number) => L + ((z + 2) / 4.5) * (R - L);
  const show = (z: number) => `z = ${fmtZ(z, 1)}`;
  return (
    <Figure narrow label="Figure 4 · interactive" title="Where a team starts a new season"
      caption={<>Starting z = {RATING.rho1} × last season + {RATING.rho2} × the season before. The z-score then becomes points using the spread of scores seen so far in the new season, so the start adapts to whatever this year's game rewards.</>}>
      <div className="mb-3 grid gap-4 sm:grid-cols-2">
        <Slider id="hiw-z1" label="Finished last season" value={z1} display={show(z1)} min={-2} max={2.5} step={0.1} onChange={setZ1} />
        <Slider id="hiw-z2" label="The season before" value={z2} display={show(z2)} min={-2} max={2.5} step={0.1} onChange={setZ2} />
      </div>
      <ScrollX label="Carry-over chart">
        <Chart viewBox="0 0 640 150" label={`Number line of starting z-scores: this team starts at ${fmtZ(s)}; a team with no history starts at ${fmtZ(RATING.rookieZ, 1)}.`}>
          <line x1={L} x2={R} y1={mid} y2={mid} className="axis" />
          {[-2, -1, 0, 1, 2].map((z) => (
            <g key={z}><line x1={x(z)} x2={x(z)} y1={mid - 5} y2={mid + 5} className="axis" /><text x={x(z)} y={mid + 22} textAnchor="middle">{z > 0 ? `+${z}` : z < 0 ? `−${-z}` : "0"}</text></g>
          ))}
          <text x={x(0.25)} y={mid + 42} textAnchor="middle">z-score (0 = season average)</text>
          <g transform={`translate(${x(RATING.rookieZ)},0)`}>
            <line x1={0} x2={0} y1={36} y2={mid} stroke="var(--hiw-blue)" strokeWidth={2} />
            <circle cx={0} cy={mid} r={8} fill="var(--hiw-blue)" />
            <text x={0} y={28} textAnchor="middle" className="t-ink">no history: {fmtZ(RATING.rookieZ, 1)}</text>
          </g>
          <g className="glide" style={{ transform: `translate(${x(z1)}px, 0px)` }}>
            <line x1={0} x2={0} y1={16} y2={mid} stroke="var(--hiw-muted)" strokeWidth={2} strokeDasharray="3 3" />
            <circle cx={0} cy={mid} r={5} fill="var(--hiw-muted)" />
            <text x={0} y={10} textAnchor="middle">last season {fmtZ(z1)}</text>
          </g>
          <g className="glide" style={{ transform: `translate(${x(s)}px, 0px)` }}>
            <line x1={0} x2={0} y1={58} y2={mid} stroke="var(--color-accent)" strokeWidth={2} />
            <circle cx={0} cy={mid} r={9} fill="var(--color-accent)" />
            <text x={0} y={52} textAnchor="middle" className="t-ink">starts at {fmtZ(s)}</text>
          </g>
        </Chart>
      </ScrollX>
    </Figure>
  );
}
