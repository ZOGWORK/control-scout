// The event page's tab icons (original artwork in BreakdownIcons' style: 24-unit grid, round strokes, currentColor;
// a touch heavier, with soft fills, to sit beside the tabs' bold labels), so each tab reads at a glance.
// Presentation only: the tab's label is its name.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/** A soft fill under an outline, so a 16px icon has the weight of its bold label. */
const soft = { fill: "currentColor", fillOpacity: 0.22 } as const;

/** Matches: the field from above, split down the middle into the two alliances' halves. */
export const MatchesTabIcon = (p: IconProps) => (
  <Svg {...p}><rect x={2.5} y={5} width={19} height={14} rx={3} {...soft} /><path d="M12 5v14" /><circle cx={12} cy={12} r={2.2} fill="currentColor" stroke="none" /></Svg>
);
/** Rankings: a three-step podium, first place in the middle. */
export const RankingsTabIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 20v-6h6V8h6v3h6v9Z" {...soft} /><path d="M9 20v-6M15 20v-9" /></Svg>
);
/** Insights: a rising line on a chart's axes, shaded under it. */
export const InsightsTabIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 4v16h16" /><path d="M8 16v-1l3-4 3 2.5 4-5V16Z" {...soft} stroke="none" /><path d="m8 15 3-4 3 2.5 4-5" /></Svg>
);
/** Teams: a robot head in front of a second one. */
export const TeamsTabIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 8h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1" />
    <rect x={3} y={9} width={12} height={10} rx={2.5} {...soft} /><path d="M9 9V6" /><circle cx={9} cy={4.5} r={1.5} fill="currentColor" stroke="none" />
    <path d="M7 14h.01M11 14h.01" strokeWidth={3} />
  </Svg>
);
/** Playoffs: a bracket, two alliances meeting and one going through. */
export const PlayoffsTabIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 5h5v14H3M8 12h6" /><circle cx={18} cy={12} r={3} {...soft} /></Svg>
);
/** Awards: a medal on its ribbon. */
export const AwardsTabIcon = (p: IconProps) => (
  <Svg {...p}><path d="m8 3 3 7M16 3l-3 7" /><circle cx={12} cy={15} r={5.5} {...soft} /><circle cx={12} cy={15} r={1.8} fill="currentColor" stroke="none" /></Svg>
);
/** Odds: a die, three pips on the diagonal. */
export const OddsTabIcon = (p: IconProps) => (
  <Svg {...p}><rect x={4} y={4} width={16} height={16} rx={3.5} {...soft} /><path d="M8.5 8.5h.01M12 12h.01M15.5 15.5h.01" strokeWidth={3.2} /></Svg>
);
