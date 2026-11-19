// v8 (docs/design/v8-revamp-brief.md §3.1, §5 Charts; owner 11-19: "too grey, colour is needed for the eye to land
// on something"): search answers in soft colour. Every palette entry keeps its v8-off classes and gains `v8:` ones
// after them, so v8 off draws exactly as before and v8 on draws text and thin accents only, never a full-colour block:
//   fill  a light tint of the colour with the colour's text (a chip);
//   text  the colour (a number or word that carries the meaning);
//   bar   the colour; edge a thin coloured bracket; tint nothing (no washed panel); stroke the colour.
// Category colours (the same on every answer): OPR purple, Auto blue, TeleOp orange, Endgame green, Penalties red.
// Meanings with no colour of their own in v8 (RP's yellow, the award kinds, No, a reference) stay neutral.
// The `v8` variant is registered after `dark` (src/index.css), so it wins over `dark:` classes of the same property.
import { SEARCH_PALETTE, type Meaning } from "../../../lib/textTones";

type Tone = { family: string; label: string; fill: string; text: string; bar: string; edge: string; tint: string; stroke: string };
/** `icon`: a tile's small icon in the colour (set from the tile, over StatTile's faint v8 icon). */
type Soft = { fill: string; text: string; bar: string; edge: string; stroke: string; icon: string };

/** v8's soft colours, each written out whole (Tailwind only builds classes it can read in the source). */
export const V8_SOFT = {
  accent: { fill: "v8:bg-accent/10 v8:text-accent", text: "v8:text-accent", bar: "v8:bg-accent", edge: "v8:border-l-accent/70", stroke: "v8:stroke-accent", icon: "v8:[&_svg]:text-accent" },
  purple: { fill: "v8:bg-violet-400/10 v8:text-violet-300", text: "v8:text-violet-300", bar: "v8:bg-violet-400", edge: "v8:border-l-violet-400/70", stroke: "v8:stroke-violet-400", icon: "v8:[&_svg]:text-violet-300" },
  blue: { fill: "v8:bg-sky-400/10 v8:text-sky-300", text: "v8:text-sky-300", bar: "v8:bg-sky-400", edge: "v8:border-l-sky-400/70", stroke: "v8:stroke-sky-400", icon: "v8:[&_svg]:text-sky-300" },
  orange: { fill: "v8:bg-orange-400/10 v8:text-orange-300", text: "v8:text-orange-300", bar: "v8:bg-orange-400", edge: "v8:border-l-orange-400/70", stroke: "v8:stroke-orange-400", icon: "v8:[&_svg]:text-orange-300" },
  green: { fill: "v8:bg-emerald-400/10 v8:text-emerald-300", text: "v8:text-emerald-300", bar: "v8:bg-emerald-400", edge: "v8:border-l-emerald-400/70", stroke: "v8:stroke-emerald-400", icon: "v8:[&_svg]:text-emerald-300" },
  red: { fill: "v8:bg-rose-400/10 v8:text-rose-300", text: "v8:text-rose-300", bar: "v8:bg-rose-400", edge: "v8:border-l-rose-400/70", stroke: "v8:stroke-rose-400", icon: "v8:[&_svg]:text-rose-300" },
  live: { fill: "v8:bg-live/10 v8:text-live", text: "v8:text-live", bar: "v8:bg-live", edge: "v8:border-l-live/70", stroke: "v8:stroke-live", icon: "v8:[&_svg]:text-live" },
  neutral: { fill: "v8:bg-white/[0.08] v8:text-foreground", text: "v8:text-foreground", bar: "v8:bg-white/30", edge: "v8:border-l-white/15", stroke: "v8:stroke-white/30", icon: "v8:[&_svg]:text-text-faint" },
} as const satisfies Record<string, Soft>;
export type SoftColour = keyof typeof V8_SOFT;

/** Each meaning's v8 colour (phases by the category colours; the rest quiet unless their colour says something). */
const MEANING_SOFT: Record<Meaning, SoftColour> = {
  auto: "blue", teleop: "orange", endgame: "green", pen: "red", rp: "neutral",
  inspire: "neutral", winning: "neutral", finalist: "neutral", judged: "neutral", performance: "neutral",
  live: "live", upcoming: "accent", finished: "green",
  yes: "green", no: "neutral", count: "accent", reference: "neutral", record: "accent",
};

export const V8_FILL = V8_SOFT.neutral.fill;
export const V8_TEXT = V8_SOFT.neutral.text;
export const V8_BAR = V8_SOFT.neutral.bar;
export const V8_EDGE = V8_SOFT.neutral.edge;
export const V8_TINT = "v8:bg-transparent";
export const V8_STROKE = V8_SOFT.neutral.stroke;

/** One swatch in a v8 soft colour (the v8-off classes first, untouched): `m`'s colour, or `colour`, else neutral. */
export function calm<T extends { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string }>(s: T, m?: Meaning, colour?: SoftColour): T {
  const c = V8_SOFT[colour ?? (m ? MEANING_SOFT[m] : "neutral")];
  return {
    ...s,
    fill: `${s.fill} ${c.fill}`,
    // RP's "text" is a black-on-yellow chip: in v8 plain words, no chip.
    text: `${s.text} ${c.text}${m === "rp" ? " v8:bg-transparent v8:px-0" : ""}`,
    bar: `${s.bar} ${c.bar}`,
    edge: `${s.edge} ${c.edge}`,
    tint: `${s.tint} ${V8_TINT}`,
    stroke: `${s.stroke} ${c.stroke}`,
  };
}

/** SEARCH_PALETTE with v8's neutral classes appended to every entry: use it wherever search reads the palette. */
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

/** A podium place's chip (lib/textTones PODIUM_CHIP) in v8: #1 is mint words on a mint hairline (the brief's one
 *  accent: the #1 rank), 2 and 3 plain words on a hairline. Never a fill behind text. */
export const V8_PODIUM: Record<number, string> = {
  1: "v8:bg-transparent v8:text-accent v8:ring-1 v8:ring-inset v8:ring-accent/40",
  2: "v8:bg-transparent v8:text-foreground v8:ring-1 v8:ring-inset v8:ring-white/12",
  3: "v8:bg-transparent v8:text-foreground v8:ring-1 v8:ring-inset v8:ring-white/12",
};

/** v8: a stat tile's colour by what its number is (owner 11-19), or null for the row's own (kpiSwatches):
 *  without penalties blue; a result green when won, red when lost, neutral when tied; a highest or OPR-like number
 *  purple. */
export function v8TileColour(label: string, value: unknown): SoftColour | null {
  const v = String(value ?? "");
  if (/without penalt|no penalt|\bnp\b/i.test(label)) return "blue";
  if (/^result$/i.test(label.trim()) || /^(won|lost|tied)\b/i.test(v)) return /^won\b/i.test(v) ? "green" : /^lost\b/i.test(v) ? "red" : /^tied\b/i.test(v) ? "neutral" : null;
  if (/\bopr\b|high|best|max|\btop\b|most/i.test(label)) return "purple";
  return null;
}
/** A tile's v8 classes for a colour: the thin bracket and the icon (on the tile), the value's text. */
export function v8Tile(c: SoftColour | null) {
  if (!c) return { tile: "v8:border-l-2", value: "" };
  return { tile: `v8:border-l-2 ${V8_SOFT[c].edge} ${V8_SOFT[c].icon}`, value: V8_SOFT[c].text };
}

/** v8: an event's status as a quiet hint (never a banner or a coloured strip): a soft tint chip and a small dot.
 *  Finished a soft green, upcoming the slate-blue accent, live the live red. Wins stay white elsewhere. */
export const V8_STATUS = {
  finished: { chip: "v8:bg-[#8fd3a6]/10 v8:text-[#a9dcba] v8:ring-[#8fd3a6]/25", dot: "v8:bg-[#8fd3a6]" },
  upcoming: { chip: "v8:bg-accent/10 v8:text-accent v8:ring-accent/30", dot: "v8:bg-accent" },
  live: { chip: "v8:bg-live/10 v8:text-live v8:ring-live/35", dot: "v8:bg-live" },
} as const;
/** The chip's shape in v8 (a pill with a hairline ring), with V8_STATUS's tint. */
export const V8_STATUS_CHIP = "v8:rounded-full v8:px-2 v8:py-0.5 v8:text-xs v8:font-medium v8:ring-1 v8:ring-inset";
