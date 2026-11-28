// A chart's card: its title, one line on what it shows, and the chart's box. No chart library here, so the card
// draws at once while the canvas's own chunk loads (src/components/charts/defer.ts).
import type { ReactNode } from "react";
import { Reveal } from "../motion";

export function ChartCard({ title, description, delay = 0, children }: { title: string; description: string; delay?: number; children: ReactNode }) {
  return (
    <Reveal delay={delay} className="min-w-0 rounded-2xl border border-border bg-card p-4 v8:rounded-xl v8:border-line">
      <section aria-label={title}>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
        <div className="mt-2">{children}</div>
      </section>
    </Reveal>
  );
}
