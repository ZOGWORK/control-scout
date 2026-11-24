// v8's colour for search answers. The owner's rule (11-06, kept for v8 by the search audit of 11-24, U2): exaggerate
// the colour. Every palette entry keeps its v8-off classes and gains `v8:` ones after them, so v8 off draws exactly as
// before, and v8 on draws each meaning boldly in its own hue:
//   fill  a solid chip in the colour, its words in the page colour (dark on the bright step, near-white on the deep);
//   text  the colour (a headline number, a value, a line's words);
//   bar   the colour; edge a thick left bar's colour; tint a wash of the colour behind a tile or a row; stroke too.
// The steps are Tailwind's 300/400, which v8 Light (src/index.css html[data-v8].light) maps to the deeper step of the
// same hue that reaches 4.5:1 on white, so one class list serves Dark, Dim and Light (never `v8:*-white`).
// Category colours follow the team page (owner 11-19): OPR and a highest purple, Auto blue, TeleOp orange, Endgame
// green, penalties red, ranking points yellow. Live, Upcoming and Finished, the award kinds, yes and no and a
// reference each have their own hue too, so no two meanings share one on a card.
// The `v8` variant is registered after `dark` (src/index.css), so it wins over `dark:` classes of the same property;
// `v8light` after `v8`, for the two fills whose Light step needs to go deeper still.
import { SEARCH_PALETTE, type Meaning } from "../../../lib/textTones";

type Tone = { family: string; label: string; fill: string; text: string; bar: string; edge: string; tint: string; stroke: string };
/** `icon`: a tile's small icon in the colour (set from the tile, over StatTile's faint v8 icon). */
type Bold = { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string; icon: string };

/** v8's colours, each written out whole (Tailwind only builds classes it can read in the source). */
export const V8_SOFT = {
  accent: { fill: "v8:bg-accent v8:text-accent-ink", text: "v8:text-accent", bar: "v8:bg-accent", edge: "v8:border-l-accent", tint: "v8:bg-accent/[0.1]", stroke: "v8:stroke-accent", icon: "v8:[&_svg]:text-accent" },
  purple: { fill: "v8:bg-violet-400 v8:text-background", text: "v8:text-violet-300", bar: "v8:bg-violet-400", edge: "v8:border-l-violet-400", tint: "v8:bg-violet-400/[0.1]", stroke: "v8:stroke-violet-400", icon: "v8:[&_svg]:text-violet-300" },
  blue: { fill: "v8:bg-sky-400 v8:text-background", text: "v8:text-sky-300", bar: "v8:bg-sky-400", edge: "v8:border-l-sky-400", tint: "v8:bg-sky-400/[0.1]", stroke: "v8:stroke-sky-400", icon: "v8:[&_svg]:text-sky-300" },
  orange: { fill: "v8:bg-orange-400 v8:text-background", text: "v8:text-orange-300 v8light:text-orange-800", bar: "v8:bg-orange-400", edge: "v8:border-l-orange-400", tint: "v8:bg-orange-400/[0.1]", stroke: "v8:stroke-orange-400", icon: "v8:[&_svg]:text-orange-300" },
  green: { fill: "v8:bg-emerald-400 v8:text-background", text: "v8:text-emerald-300", bar: "v8:bg-emerald-400", edge: "v8:border-l-emerald-400", tint: "v8:bg-emerald-400/[0.1]", stroke: "v8:stroke-emerald-400", icon: "v8:[&_svg]:text-emerald-300" },
  red: { fill: "v8:bg-red-400 v8:text-background v8light:bg-red-700", text: "v8:text-red-300 v8light:text-red-800", bar: "v8:bg-red-400", edge: "v8:border-l-red-400", tint: "v8:bg-red-400/[0.1]", stroke: "v8:stroke-red-400", icon: "v8:[&_svg]:text-red-300" },
  live: { fill: "v8:bg-live v8:text-background", text: "v8:text-rose-300 v8light:text-rose-800", bar: "v8:bg-live", edge: "v8:border-l-live", tint: "v8:bg-live/[0.1]", stroke: "v8:stroke-live", icon: "v8:[&_svg]:text-live" },
  yellow: { fill: "v8:bg-yellow-400 v8:text-background", text: "v8:text-yellow-300 v8light:text-yellow-800", bar: "v8:bg-yellow-400", edge: "v8:border-l-yellow-400", tint: "v8:bg-yellow-400/[0.1]", stroke: "v8:stroke-yellow-400", icon: "v8:[&_svg]:text-yellow-300" },
  amber: { fill: "v8:bg-amber-400 v8:text-background", text: "v8:text-amber-300 v8light:text-amber-800", bar: "v8:bg-amber-400", edge: "v8:border-l-amber-400", tint: "v8:bg-amber-400/[0.1]", stroke: "v8:stroke-amber-400", icon: "v8:[&_svg]:text-amber-300" },
  fuchsia: { fill: "v8:bg-fuchsia-400 v8:text-background", text: "v8:text-fuchsia-300", bar: "v8:bg-fuchsia-400", edge: "v8:border-l-fuchsia-400", tint: "v8:bg-fuchsia-400/[0.1]", stroke: "v8:stroke-fuchsia-400", icon: "v8:[&_svg]:text-fuchsia-300" },
  pink: { fill: "v8:bg-pink-400 v8:text-background", text: "v8:text-pink-300", bar: "v8:bg-pink-400", edge: "v8:border-l-pink-400", tint: "v8:bg-pink-400/[0.1]", stroke: "v8:stroke-pink-400", icon: "v8:[&_svg]:text-pink-300" },
  grape: { fill: "v8:bg-purple-400 v8:text-background", text: "v8:text-purple-300", bar: "v8:bg-purple-400", edge: "v8:border-l-purple-400", tint: "v8:bg-purple-400/[0.1]", stroke: "v8:stroke-purple-400", icon: "v8:[&_svg]:text-purple-300" },
  indigo: { fill: "v8:bg-indigo-400 v8:text-background", text: "v8:text-indigo-300", bar: "v8:bg-indigo-400", edge: "v8:border-l-indigo-400", tint: "v8:bg-indigo-400/[0.1]", stroke: "v8:stroke-indigo-400", icon: "v8:[&_svg]:text-indigo-300" },
  cyan: { fill: "v8:bg-cyan-400 v8:text-background", text: "v8:text-cyan-300", bar: "v8:bg-cyan-400", edge: "v8:border-l-cyan-400", tint: "v8:bg-cyan-400/[0.1]", stroke: "v8:stroke-cyan-400", icon: "v8:[&_svg]:text-cyan-300" },
  lime: { fill: "v8:bg-lime-400 v8:text-background", text: "v8:text-lime-300 v8light:text-lime-800", bar: "v8:bg-lime-400", edge: "v8:border-l-lime-400", tint: "v8:bg-lime-400/[0.1]", stroke: "v8:stroke-lime-400", icon: "v8:[&_svg]:text-lime-300" },
  win: { fill: "v8:bg-green-400 v8:text-background", text: "v8:text-green-300 v8light:text-green-800", bar: "v8:bg-green-400", edge: "v8:border-l-green-400", tint: "v8:bg-green-400/[0.1]", stroke: "v8:stroke-green-400", icon: "v8:[&_svg]:text-green-300" },
  rose: { fill: "v8:bg-rose-400 v8:text-background v8light:bg-rose-700", text: "v8:text-rose-300 v8light:text-rose-800", bar: "v8:bg-rose-400", edge: "v8:border-l-rose-400", tint: "v8:bg-rose-400/[0.1]", stroke: "v8:stroke-rose-400", icon: "v8:[&_svg]:text-rose-300" },
  neutral: { fill: "v8:bg-ink/[0.08] v8:text-foreground", text: "v8:text-foreground", bar: "v8:bg-ink/30", edge: "v8:border-l-ink/15", tint: "v8:bg-transparent", stroke: "v8:stroke-ink/30", icon: "v8:[&_svg]:text-text-faint" },
} as const satisfies Record<string, Bold>;
export type SoftColour = keyof typeof V8_SOFT;

/** Each meaning's v8 colour: none neutral (the owner: nothing grey for data), and the same family never two meanings
 *  that can sit on one card (a count is a number on its own card; RP sits beside phases, never beside a count). */
export const MEANING_SOFT: Record<Meaning, SoftColour> = {
  auto: "blue", teleop: "orange", endgame: "green", pen: "red", rp: "yellow",
  inspire: "fuchsia", winning: "amber", finalist: "pink", judged: "grape", performance: "indigo",
  live: "live", upcoming: "accent", finished: "lime",
  yes: "win", no: "rose", count: "yellow", reference: "cyan", record: "purple",
};

export const V8_FILL = V8_SOFT.neutral.fill;
export const V8_TEXT = V8_SOFT.neutral.text;
export const V8_BAR = V8_SOFT.neutral.bar;
export const V8_EDGE = V8_SOFT.neutral.edge;
export const V8_TINT = "v8:bg-transparent";
export const V8_STROKE = V8_SOFT.neutral.stroke;

/** One swatch in its v8 colour (the v8-off classes first, untouched): `m`'s colour, or `colour`, else neutral. */
export function calm<T extends { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string }>(s: T, m?: Meaning, colour?: SoftColour): T {
  const c = V8_SOFT[colour ?? (m ? MEANING_SOFT[m] : "neutral")];
  return {
    ...s,
    fill: `${s.fill} ${c.fill}`,
    // RP's "text" is a black-on-yellow chip: in v8 the same chip, in v8's yellow.
    text: `${s.text} ${m === "rp" ? c.fill : c.text}`,
    bar: `${s.bar} ${c.bar}`,
    edge: `${s.edge} ${c.edge}`,
    tint: `${s.tint} ${c.tint}`,
    stroke: `${s.stroke} ${c.stroke}`,
  };
}

/** SEARCH_PALETTE with v8's colour classes appended to every entry: use it wherever search reads the palette. */
export const TONE = Object.fromEntries(
  (Object.keys(SEARCH_PALETTE) as Meaning[]).map((m) => [m, calm(SEARCH_PALETTE[m] as Tone, m)]),
) as unknown as { [K in Meaning]: (typeof SEARCH_PALETTE)[K] };

/** Search results' one entrance (brief §4.2: one gentle entrance per container, only on Home and search results):
 *  each block of the column fades up 6px, 30–60ms apart and unevenly so it never reads as a metronome. CSS only, on
 *  the column's direct children: nothing waits on it and every click lands at once. None under reduced motion. v8 only. */
export const V8_STAGGER = [
  "v8:[&>*]:animate-in v8:[&>*]:fade-in-0 v8:[&>*]:[--tw-enter-translate-y:6px] v8:[&>*]:duration-[240ms] v8:[&>*]:ease-out v8:[&>*]:fill-mode-backwards",
  "v8:[&>*:nth-child(2)]:delay-[40ms] v8:[&>*:nth-child(3)]:delay-[75ms] v8:[&>*:nth-child(4)]:delay-[130ms]",
  "v8:[&>*:nth-child(5)]:delay-[165ms] v8:[&>*:nth-child(6)]:delay-[215ms] v8:[&>*:nth-child(n+7)]:delay-[250ms]",
  "motion-reduce:v8:[&>*]:animate-none",
].join(" ");

/** A podium place's chip (lib/textTones PODIUM_CHIP) in v8: #1 a solid accent chip, 2 and 3 on the accent's tint. */
export const V8_PODIUM: Record<number, string> = {
  1: "v8:bg-accent v8:text-accent-ink",
  2: "v8:bg-accent/[0.18] v8:text-foreground",
  3: "v8:bg-accent/[0.18] v8:text-foreground",
};

/** v8: a stat tile's colour by what its number is (owner 11-19), or null for the row's own (kpiSwatches):
 *  without penalties blue; a result green when won, red when lost, neutral when tied; a highest or OPR-like number
 *  purple. */
export function v8TileColour(label: string, value: unknown): SoftColour | null {
  const v = String(value ?? "");
  if (/without penalt|no penalt|\bnp\b/i.test(label)) return "blue";
  if (/^result$/i.test(label.trim()) || /^(won|lost|tied)\b/i.test(v)) return /^won\b/i.test(v) ? "win" : /^lost\b/i.test(v) ? "red" : /^tied\b/i.test(v) ? "neutral" : null;
  if (/\bopr\b|high|best|max|\btop\b|most/i.test(label)) return "purple";
  return null;
}
/** v8: the category colour a stat's label names (the team page's, owner 11-19), for a one-team card's numbers, which
 *  would otherwise all be the team's slate blue: a phase its own, OPR and a rating purple, a record or a win rate
 *  green, a rank or anything else the accent. */
export function v8Stat(label: string): SoftColour {
  const l = label.toLowerCase();
  if (/\brank|standing|place\b/.test(l)) return "accent";
  if (/\bauto(nomous)?\b/.test(l)) return "blue";
  if (/teleop|driver/.test(l)) return "orange";
  if (/endgame/.test(l)) return "green";
  if (/\bpen(alt(y|ies))?\b|fouls?/.test(l)) return "red";
  if (/\brp\b|ranking points?/.test(l)) return "yellow";
  if (/\bopr\b|rating|score|points/.test(l)) return "purple";
  if (/record|\bwins?\b|win rate|won/.test(l)) return "win";
  return "accent";
}

/** A tile's v8 classes for a colour: a thick bar down its left on a wash of the colour, its icon in the colour, and
 *  the value's text. Neutral: the bar alone, in ink. */
export function v8Tile(c: SoftColour | null) {
  if (!c || c === "neutral") return { tile: "v8:border-l-4 v8:border-l-ink/15", value: "" };
  return { tile: `v8:border-l-4 ${V8_SOFT[c].edge} ${V8_SOFT[c].tint} ${V8_SOFT[c].icon}`, value: V8_SOFT[c].text };
}

/** v8: an event's status, each its own hue, as a solid chip and a dot: finished lime, upcoming the slate-blue
 *  accent, live the live red. */
export const V8_STATUS = {
  finished: { chip: `${V8_SOFT.lime.fill} v8:ring-transparent`, dot: V8_SOFT.lime.bar },
  upcoming: { chip: `${V8_SOFT.accent.fill} v8:ring-transparent`, dot: V8_SOFT.accent.bar },
  live: { chip: `${V8_SOFT.live.fill} v8:ring-transparent`, dot: V8_SOFT.live.bar },
} as const;
/** The chip's shape in v8 (a pill), with V8_STATUS's fill. */
export const V8_STATUS_CHIP = "v8:rounded-full v8:px-2 v8:py-0.5 v8:text-xs v8:font-semibold v8:ring-1 v8:ring-inset";
