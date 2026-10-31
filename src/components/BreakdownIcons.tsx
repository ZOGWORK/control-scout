// The match breakdown's own icon set (original artwork, one style: 24-unit grid, 2-unit round strokes,
// currentColor). One icon per score-sheet row and per bonus ranking point. Icons are presentation only:
// whether an RP was earned is drawn by RpChip from the data, never by the icon itself.
import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      {children}
    </svg>
  );
}

/** A small bee: a striped body with two wings. `s` scales it around its centre. */
function Bee({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={-1.4} cy={-2.4} rx={1.7} ry={1.3} strokeWidth={1.4} />
      <ellipse cx={1.4} cy={-2.4} rx={1.7} ry={1.3} strokeWidth={1.4} />
      <ellipse cx={0} cy={0.6} rx={3.2} ry={2.1} fill="currentColor" stroke="none" />
      <path d="M-0.9 -1.2v3.6M1.1 -1.2v3.6" stroke="var(--color-card, #111)" strokeWidth={0.8} />
    </g>
  );
}

/** A flat-topped honeycomb cell centred on (x, y). */
const hex = (x: number, y: number, r: number) =>
  [0, 60, 120, 180, 240, 300].map((a) => `${(x + r * Math.cos((a * Math.PI) / 180)).toFixed(2)},${(y + r * Math.sin((a * Math.PI) / 180)).toFixed(2)}`).join(" ");

// ---- Bonus ranking points -------------------------------------------------------------------------------

/** BIOBUZZ SWARM: three bees flying together, no honeycomb. */
export const SwarmIcon = (p: IconProps) => (
  <Svg {...p}><Bee x={6.5} y={17} s={0.95} /><Bee x={17.5} y={17} s={0.95} /><Bee x={12} y={8} s={0.95} /><path d="M3 9.5c1.5-3 4-4.5 5-4.5M21 9.5c-1.5-3-4-4.5-5-4.5" strokeWidth={1.4} strokeDasharray="1.5 2" /></Svg>
);
/** BIOBUZZ POLLINATOR 1: one bee over a single honeycomb cell. */
export const Pollinator1Icon = (p: IconProps) => (
  <Svg {...p}><polygon points={hex(12, 15.5, 6.5)} /><Bee x={12} y={6.2} s={0.9} /></Svg>
);
/** BIOBUZZ POLLINATOR 2: one bee over two joined honeycomb cells. */
export const Pollinator2Icon = (p: IconProps) => (
  <Svg {...p}><polygon points={hex(7, 16, 4.6)} /><polygon points={hex(17, 16, 4.6)} /><Bee x={12} y={6.2} s={0.9} /></Svg>
);
/** DECODE MOVEMENT: a robot base moving off its line. */
export const MovementIcon = (p: IconProps) => (
  <Svg {...p}><rect x={9} y={8} width={8} height={8} rx={2} /><path d="M17 12h4m-2-2 2 2-2 2M3 9h3M2 12h4M3 15h3" /></Svg>
);
/** DECODE GOAL: a target. */
export const GoalIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={12} cy={12} r={8.5} /><circle cx={12} cy={12} r={4.5} /><circle cx={12} cy={12} r={1} fill="currentColor" /></Svg>
);
/** DECODE PATTERN: a sequence of three balls, the middle one different. */
export const PatternIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={5} cy={12} r={3} fill="currentColor" /><circle cx={12} cy={12} r={3} /><circle cx={19} cy={12} r={3} fill="currentColor" /></Svg>
);
/** Any other bonus RP: a ribbon. */
export const RibbonIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={12} cy={9} r={5.5} /><path d="m8.5 13.5-2 7 5.5-3 5.5 3-2-7" /></Svg>
);

const RP_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  swarm: SwarmIcon, "pollinator 1": Pollinator1Icon, "pollinator 2": Pollinator2Icon,
  movement: MovementIcon, goal: GoalIcon, pattern: PatternIcon,
};
export const rpIcon = (label: string) => RP_ICONS[label.trim().toLowerCase()] ?? RibbonIcon;

// ---- Score-sheet rows -----------------------------------------------------------------------------------

export const AutoIcon = (p: IconProps) => (
  <Svg {...p}><rect x={5} y={8} width={14} height={11} rx={3} /><path d="M12 8V4.5" /><circle cx={12} cy={3.5} r={1} fill="currentColor" /><circle cx={9.5} cy={13} r={1} fill="currentColor" stroke="none" /><circle cx={14.5} cy={13} r={1} fill="currentColor" stroke="none" /><path d="M10 16.2h4" /></Svg>
);
export const TeleOpIcon = (p: IconProps) => (
  <Svg {...p}><path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.4l-.8 4A2.6 2.6 0 0 1 16 17.5L14.5 15h-5L8 17.5a2.6 2.6 0 0 1-4.6-1.1l-.8-4A4.5 4.5 0 0 1 7 7Z" /><path d="M7 10.5v3M5.5 12h3" /><circle cx={16} cy={10.8} r={0.6} fill="currentColor" /><circle cx={17.5} cy={13} r={0.6} fill="currentColor" /></Svg>
);
export const EndgameIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={12} cy={13.5} r={7.5} /><path d="M10 2.5h4M12 2.5v3.5M12 13.5l3-3M18.5 6l1.5-1.5" /></Svg>
);
export const CleanIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 2.8 19.5 5.6v5.6c0 4.7-3.2 8.2-7.5 9.9-4.3-1.7-7.5-5.2-7.5-9.9V5.6Z" /><path d="m8.6 12 2.4 2.4 4.6-4.8" /></Svg>
);
export const FoulIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 21V3.5" /><path d="M5 4.5c3-1.6 5.5 1.6 8.5 0s4.5-.8 5.5 0V13c-1-.8-2.5-1.6-5.5 0s-5.5-1.6-8.5 0" /></Svg>
);
export const MajorFoulIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 3.2 21.5 20h-19Z" /><path d="M12 9.5v4.5" /><circle cx={12} cy={17} r={0.6} fill="currentColor" /></Svg>
);
export const MinorFoulIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={12} cy={12} r={8.5} /><path d="M12 8v4.5" /><circle cx={12} cy={15.8} r={0.6} fill="currentColor" /></Svg>
);
export const TotalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M18 5H6.5l6 7-6 7H18" /></Svg>
);
export const LeaveIcon = (p: IconProps) => (
  <Svg {...p}><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" /><path d="M10 12h10.5m-3.5-3.5 3.5 3.5-3.5 3.5" /></Svg>
);
export const ParkIcon = (p: IconProps) => (
  <Svg {...p}><rect x={3.5} y={3.5} width={17} height={17} rx={3} /><path d="M9.5 17V7h3.2a3 3 0 0 1 0 6H9.5" /></Svg>
);
export const HiveIcon = (p: IconProps) => (
  <Svg {...p}><polygon points={hex(12, 12, 8.5)} /><polygon points={hex(12, 12, 3.5)} /></Svg>
);
export const FlowerIcon = (p: IconProps) => (
  <Svg {...p}>{[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={12 + 5 * Math.sin((a * Math.PI) / 180)} cy={10 - 5 * Math.cos((a * Math.PI) / 180)} r={2.6} />)}<circle cx={12} cy={10} r={1.4} fill="currentColor" /><path d="M12 17.5V22" /></Svg>
);
export const GardenIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 21v-9" /><path d="M12 13c0-3.5-2.5-6-6.5-6 0 3.5 2.5 6 6.5 6ZM12 12c0-3.5 2.5-6 6.5-6 0 3.5-2.5 6-6.5 6Z" /><path d="M4 21h16" /></Svg>
);
export const RowDotIcon = (p: IconProps) => (
  <Svg {...p}><circle cx={12} cy={12} r={3} /></Svg>
);

const ROW_ICONS: Record<string, (p: IconProps) => ReactNode> = {
  auto: AutoIcon, teleop: TeleOpIcon, endgame: EndgameIcon, "no penalties": CleanIcon, "fouls given away": FoulIcon,
  "major fouls": MajorFoulIcon, "minor fouls": MinorFoulIcon, total: TotalIcon,
  leave: LeaveIcon, park: ParkIcon, hive: HiveIcon, flower: FlowerIcon, garden: GardenIcon,
};
export const rowIcon = (label: string) => ROW_ICONS[label.trim().toLowerCase()] ?? RowDotIcon;
