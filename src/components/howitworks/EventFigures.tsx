// Section 04 figures: one simulated run, the 1,000-event toy qualifier and
// the advancement points chart.
import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { HBars, type HRow } from "./charts";
import { TOY, histStats, rng, toyEvent, toyField } from "./math";
import { Chart, Figure, Kpi, Note, ScrollX, Seg, useReduced, useTip } from "./ui";

const STEPS = [
  ["Draw today's strength", "each robot ~ its rating ± uncertainty"],
  ["Play the remaining quals", "real results kept; the rest simulated"],
  ["Rank the teams", "RP + bonus RPs, official tiebreakers"],
  ["Select alliances", "captains in rank order pick by strength + rank"],
  ["Run the bracket", "double elimination on the real bracket"],
  ["Awards + advancement", "points, then slots; skip already-qualified"],
] as const;

export function RunFlow() {
  const x0 = 24, w = 592, h = 42, gap = 12;
  return (
    <Figure narrow label="Figure 6" title="One simulated run"
      caption="Two thousand runs give two thousand outcomes. If your team advances in 820 of them, your odds are 41%. The same runs give your likely rank range, your chance of being a captain or a pick, and your chance of winning.">
      <ScrollX label="Simulation steps" min={480}>
        <Chart viewBox="0 0 640 340" label="Flow of a single simulated event: draw today's robot strengths, play remaining quals, rank teams, select alliances, run the double-elimination bracket, hand out awards, count advancement points.">
          {STEPS.map(([a, s], i) => {
            const y = 8 + i * (h + gap);
            return (
              <g key={a}>
                <g className="pop" style={{ ["--i" as string]: i * 2 }}>
                  <rect x={x0} y={y} width={w} height={h} rx={8} fill="var(--color-muted)" stroke="var(--hiw-line)" />
                  <rect x={x0} y={y} width={40} height={h} rx={8} fill="var(--color-accent)" />
                  <rect x={x0 + 30} y={y} width={10} height={h} fill="var(--color-accent)" />
                  <text x={x0 + 20} y={y + h / 2 + 5} textAnchor="middle" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, fill: "var(--color-accent-ink)" }}>{i + 1}</text>
                  <text x={x0 + 56} y={y + 18} className="t-ink t-disp">{a}</text>
                  <text x={x0 + 56} y={y + 34}>{s}</text>
                </g>
                {i < STEPS.length - 1 && <line x1={x0 + 20} x2={x0 + 20} y1={y + h} y2={y + h + gap} stroke="var(--color-accent)" strokeWidth={3} />}
              </g>
            );
          })}
          <text x={x0 + w} y={8 + 6 * (h + gap) + 6} textAnchor="end" className="t-gold t-disp fade-late">× 2,000 runs per event</text>
        </Chart>
      </ScrollX>
    </Figure>
  );
}

type Robot = "105" | "72" | "52";
const FIELD = toyField();
const empty = () => new Array<number>(TOY.teams).fill(0);

export function QualifierSim() {
  const reduced = useReduced();
  const tip = useTip();
  const [robot, setRobot] = useState<Robot>("72");
  const [counts, setCounts] = useState<number[]>(empty);
  const [running, setRunning] = useState(false);
  const raf = useRef(0);
  const rand = useRef(rng(7));
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const stop = () => { cancelAnimationFrame(raf.current); setRunning(false); };
  const choose = (v: Robot) => { stop(); setRobot(v); setCounts(empty()); };
  const run = () => {
    stop();
    const you = Number(robot);
    const acc = empty();
    let runs = 0;
    setRunning(true);
    setCounts(empty());
    // Chunked across frames so the page never freezes; ~25 frames for 1,000 events.
    const batch = reduced ? 250 : 40;
    const tick = () => {
      for (let k = 0; k < batch && runs < TOY.runs; k++) { acc[toyEvent(you, FIELD, rand.current) - 1]++; runs++; }
      setCounts([...acc]);
      if (runs < TOY.runs) raf.current = requestAnimationFrame(tick); else setRunning(false);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const st = histStats(counts);
  const L = 36, R = 510, T = 12, B = 200;
  const max = Math.max(0.2, ...counts.map((c) => (st.runs ? c / st.runs : 0)));
  const ymax = Math.ceil(max * 10) / 10;
  const y = (p: number) => B - (p / ymax) * (B - T);
  const bw = (R - L) / TOY.teams;
  const gridLines: number[] = [];
  for (let p = 0; p <= ymax + 1e-9; p += 0.1) gridLines.push(Math.round(p * 10) / 10);
  const done = st.runs >= TOY.runs;

  return (
    <Figure label="Interactive" title="Run a 24-team qualifier 1,000 times"
      actions={<Button size="sm" onClick={run} disabled={running}>{done ? <RotateCcw /> : <Play />}{done ? "Run again" : running ? "Running…" : "Run 1,000 events"}</Button>}
      caption="The spread is the point. Even a top-3 robot sometimes lands outside the top 4 because of the schedule, its partners and a bad day; an underdog occasionally sneaks in. Control Scout reports exactly these chances instead of a single guess.">
      <div className="grid items-center gap-6 max-sm:gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid min-w-0 gap-4">
          <div className="grid gap-1.5">
            <Note>Your robot</Note>
            <Seg label="Your robot's strength" value={robot} onChange={choose} options={[{ value: "105", label: "Top-3 robot" }, { value: "72", label: "Mid-pack" }, { value: "52", label: "Underdog" }]} />
          </div>
          <div className="grid grid-cols-3 gap-2" aria-live="polite">
            <Kpi value={st.runs.toLocaleString("en-US")} label="events run" />
            <Kpi value={st.top4 == null ? "–" : `${Math.round(st.top4 * 100)}%`} label="seeded top 4" tone="gold" />
            <Kpi value={st.median == null ? "–" : `#${st.median}`} label="typical rank" />
          </div>
          <Note>A toy version: 24 robots, 6 qualification matches each with random partners, 2 ranking points per win and the average score as the tiebreaker. Each robot's form for the day is drawn once per run. The real simulator adds bonus RPs, alliance selection, playoffs, awards and the official rules.</Note>
        </div>
        <ScrollX label="Rank histogram" min={420}>
          <Chart viewBox="0 0 520 240" label={st.runs ? `Histogram of your robot's final qualification rank across ${st.runs} simulated events: top 4 in ${Math.round((st.top4 ?? 0) * 100)}%.` : "Histogram of your robot's final qualification rank; press Run to fill it."} interactive>
            {gridLines.map((p) => <g key={p}><line x1={L} x2={R} y1={y(p)} y2={y(p)} className="grid" /><text x={L - 6} y={y(p) + 4} textAnchor="end">{Math.round(p * 100)}%</text></g>)}
            <rect x={L} y={T} width={bw * 4} height={B - T} fill="var(--color-accent)" opacity={0.1} />
            <text x={L + 4} y={T + 12} className="t-gold">top 4</text>
            {counts.map((c, i) => {
              const p = st.runs ? c / st.runs : 0;
              return (
                <g key={i}>
                  {st.runs > 0 && <rect x={L + i * bw + 2} y={y(p)} width={bw - 4} height={Math.max(0, B - y(p))} rx={2} fill={i < 4 ? "var(--color-accent)" : "var(--hiw-muted)"} opacity={i < 4 ? 1 : 0.55} {...tip(`rank ${i + 1}: ${(p * 100).toFixed(1)}% of runs`)} />}
                  {(i === 0 || (i + 1) % 4 === 0) && <text x={L + i * bw + bw / 2} y={B + 16} textAnchor="middle">{i + 1}</text>}
                </g>
              );
            })}
            {!st.runs && <text x={(L + R) / 2} y={(T + B) / 2} textAnchor="middle" className="t-ink">Press “Run 1,000 events”</text>}
            <text x={(L + R) / 2} y={B + 34} textAnchor="middle">final qualification rank</text>
          </Chart>
        </ScrollX>
      </div>
    </Figure>
  );
}

export function PointsChart() {
  return (
    <Figure narrow label="Figure 7" title="2025–26 advancement points, at a glance"
      caption="All of these were read off official FIRST data and checked against every published total (1,786 of 1,786 match). Only a team's highest award counts. The quals points come from a bell-curve formula on rank, so a mid-table team still earns a few.">
      <ScrollX label="Advancement points chart">
        <HBars
          label="Bar chart of maximum advancement points by source: Inspire award 60, win the event 40, captain of alliance 1: 20, quals rank 1: about 16, other judged award 12."
          max={70} fmt={(v) => String(v)} ticks={[0, 20, 40, 60]} left={170}
          rows={([
            { label: "Inspire award (1st)", v: 60, tone: "gold", strong: true },
            { label: "Win the event", v: 40, tone: "red" },
            { label: "Captain, alliance 1", v: 20, tone: "blue" },
            { label: "Rank 1 in quals (~)", v: 16, tone: "muted" },
            { label: "Other judged award", v: 12, tone: "gold", dim: true },
          ] as HRow[]).map((r) => ({ ...r, tip: `${r.label}: up to ${r.v} advancement points` }))}
        />
      </ScrollX>
    </Figure>
  );
}
