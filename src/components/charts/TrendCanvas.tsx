// The team page's trend line: recharts, in its own chunk (loaded by src/components/charts/defer.ts after first paint).
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart";

export interface TrendCanvasProps {
  /** One row an event, oldest first; `value` is null where the stat has no measurement. */
  rows: { i: number; name: string; value: number | null }[];
  label: string;
  suffix?: string;
}

export function TrendCanvas({ rows, label, suffix }: TrendCanvasProps) {
  return (
    <ChartContainer config={{ value: { label, color: "var(--color-accent)" } }} className="h-56 w-full">
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="i" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(i: number) => `E${i + 1}`} label={{ value: "Event, oldest to newest", position: "insideBottom", offset: -12, className: "fill-muted-foreground text-xs" }} />
        <YAxis tickLine={false} axisLine={false} width={44} label={{ value: suffix ? "Percent" : "Points", angle: -90, position: "insideLeft", offset: 8, style: { textAnchor: "middle" }, className: "fill-muted-foreground text-xs" }} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(i: number) => rows[i]?.name ?? ""} />} />
        <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-value)" }} activeDot={{ r: 6 }} connectNulls animationDuration={700} />
      </LineChart>
    </ChartContainer>
  );
}
