// Compare's two charts: recharts, in their own chunk (loaded by src/components/charts/defer.ts after first paint).
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from "recharts";
import type { CompareTeam } from "../../shared/api";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";
import { ChartCard } from "./ChartCard";

/** The compare trend's line patterns, one per chosen team (four at most): solid, dashed, dotted, dash-dot. */
const LINE_DASH = [undefined, "6 3", "2 3", "8 3 2 3"];

export function CompareCharts({ teams, colors }: { teams: CompareTeam[]; colors: string[] }) {
  const phase = (["auto", "teleop", "endgame"] as const).map((k) => ({ phase: k === "auto" ? "Auto" : k === "teleop" ? "TeleOp" : "Endgame", ...Object.fromEntries(teams.map((x) => [String(x.team.number), x.stats?.opr[k].value ?? 0])) }));
  const config = Object.fromEntries(teams.map((x, i) => [String(x.team.number), { label: String(x.team.number), color: colors[i] }]));
  const maxEvents = Math.max(0, ...teams.map((x) => x.events.length));
  const trend = Array.from({ length: maxEvents }, (_, i) => ({ i: `E${i + 1}`, ...Object.fromEntries(teams.map((x) => [String(x.team.number), x.events[i]?.opr ?? null])) }));
  return (
    <>
      <ChartCard title="OPR by phase" description="From each team's best event this season" delay={0.06}>
        <ChartContainer config={config} className="h-48 w-full">
          <BarChart data={phase} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="phase" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <Legend />
            {teams.map((x) => <Bar key={x.team.number} dataKey={String(x.team.number)} fill={`var(--color-${x.team.number})`} radius={[4, 4, 0, 0]} />)}
          </BarChart>
        </ChartContainer>
      </ChartCard>
      <ChartCard title="OPR event by event" description="Each team's events in order (E1 = its first)" delay={0.12}>
        {maxEvents < 2 ? <p className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">Needs two events to draw a line.</p> : (
          <ChartContainer config={config} className="h-48 w-full">
            <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="i" tickLine={false} axisLine={false} />
              <YAxis tickLine={false} axisLine={false} width={32} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Legend iconType="plainline" />
              {/* Each line has its own dash and dot shape as well as its colour, so the teams tell apart without colour. */}
              {teams.map((x, i) => <Line key={x.team.number} dataKey={String(x.team.number)} stroke={`var(--color-${x.team.number})`} strokeWidth={2} strokeDasharray={LINE_DASH[i % LINE_DASH.length]} connectNulls dot={{ r: 3 }} />)}
            </LineChart>
          </ChartContainer>
        )}
      </ChartCard>
    </>
  );
}
