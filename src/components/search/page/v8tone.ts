// v8's colour for search answers, soft (owner 11-19 "colour is needed for the eye to land on something"; 11-24 on
// the U2 audit's bold pass: "not so bold, accent colours"). Every palette entry keeps its v8-off classes and gains
// `v8:` ones after them, so v8 off draws exactly as before and v8 on draws text and thin accents only:
//   fill  a light tint of the colour with the colour's text (a chip);
//   text  the colour (a number or word that carries the meaning);
//   bar   the colour; edge a thin coloured bracket; tint nothing (no washed panel); stroke the colour.
// v8 Light (src/index.css html[data-v8].light) maps the 300/400 steps to deeper ones that reach 4.5:1 on white, so
// one class list serves Dark, Dim and Light (never `v8:*-white`).
// Category colours follow the team page: OPR purple, Auto blue, TeleOp orange, Endgame green, Penalties red, RP yellow.
// The `v8` variant is registered after `dark` (src/index.css), so it wins over `dark:` classes of the same property.
import { SEARCH_PALETTE, type Meaning } from "../../../lib/textTones";

type Tone = { family: string; label: string; fill: string; text: string; bar: string; edge: string; tint: string; stroke: string };
/** `icon`: a tile's small icon in the colour (set from the tile, over StatTile's faint v8 icon). */
type Soft = { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string; icon: string };

/** v8's soft colours, each written out whole (Tailwind only builds classes it can read in the source). */
export const V8_SOFT = {
  accent: { fill: "v8:bg-accent/10 v8:text-accent", text: "v8:text-accent", bar: "v8:bg-accent", edge: "v8:border-l-accent/70", tint: "v8:bg-transparent", stroke: "v8:stroke-accent", icon: "v8:[&_svg]:text-accent" },
  purple: { fill: "v8:bg-violet-400/10 v8:text-violet-300", text: "v8:text-violet-300", bar: "v8:bg-violet-400", edge: "v8:border-l-violet-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-violet-400", icon: "v8:[&_svg]:text-violet-300" },
  blue: { fill: "v8:bg-sky-400/10 v8:text-sky-300", text: "v8:text-sky-300", bar: "v8:bg-sky-400", edge: "v8:border-l-sky-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-sky-400", icon: "v8:[&_svg]:text-sky-300" },
  orange: { fill: "v8:bg-orange-400/10 v8:text-orange-300 v8light:text-orange-800", text: "v8:text-orange-300 v8light:text-orange-800", bar: "v8:bg-orange-400", edge: "v8:border-l-orange-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-orange-400", icon: "v8:[&_svg]:text-orange-300" },
  green: { fill: "v8:bg-emerald-400/10 v8:text-emerald-300", text: "v8:text-emerald-300", bar: "v8:bg-emerald-400", edge: "v8:border-l-emerald-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-emerald-400", icon: "v8:[&_svg]:text-emerald-300" },
  red: { fill: "v8:bg-red-400/10 v8:text-red-300 v8light:text-red-800", text: "v8:text-red-300 v8light:text-red-800", bar: "v8:bg-red-400", edge: "v8:border-l-red-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-red-400", icon: "v8:[&_svg]:text-red-300" },
  live: { fill: "v8:bg-live/10 v8:text-rose-300 v8light:text-rose-800", text: "v8:text-rose-300 v8light:text-rose-800", bar: "v8:bg-live", edge: "v8:border-l-live/70", tint: "v8:bg-transparent", stroke: "v8:stroke-live", icon: "v8:[&_svg]:text-live" },
  yellow: { fill: "v8:bg-yellow-400/10 v8:text-yellow-300 v8light:text-yellow-800", text: "v8:text-yellow-300 v8light:text-yellow-800", bar: "v8:bg-yellow-400", edge: "v8:border-l-yellow-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-yellow-400", icon: "v8:[&_svg]:text-yellow-300" },
  amber: { fill: "v8:bg-amber-400/10 v8:text-amber-300 v8light:text-amber-800", text: "v8:text-amber-300 v8light:text-amber-800", bar: "v8:bg-amber-400", edge: "v8:border-l-amber-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-amber-400", icon: "v8:[&_svg]:text-amber-300" },
  fuchsia: { fill: "v8:bg-fuchsia-400/10 v8:text-fuchsia-300", text: "v8:text-fuchsia-300", bar: "v8:bg-fuchsia-400", edge: "v8:border-l-fuchsia-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-fuchsia-400", icon: "v8:[&_svg]:text-fuchsia-300" },
  pink: { fill: "v8:bg-pink-400/10 v8:text-pink-300", text: "v8:text-pink-300", bar: "v8:bg-pink-400", edge: "v8:border-l-pink-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-pink-400", icon: "v8:[&_svg]:text-pink-300" },
  grape: { fill: "v8:bg-purple-400/10 v8:text-purple-300", text: "v8:text-purple-300", bar: "v8:bg-purple-400", edge: "v8:border-l-purple-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-purple-400", icon: "v8:[&_svg]:text-purple-300" },
  indigo: { fill: "v8:bg-indigo-400/10 v8:text-indigo-300", text: "v8:text-indigo-300", bar: "v8:bg-indigo-400", edge: "v8:border-l-indigo-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-indigo-400", icon: "v8:[&_svg]:text-indigo-300" },
  cyan: { fill: "v8:bg-cyan-400/10 v8:text-cyan-300", text: "v8:text-cyan-300", bar: "v8:bg-cyan-400", edge: "v8:border-l-cyan-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-cyan-400", icon: "v8:[&_svg]:text-cyan-300" },
  lime: { fill: "v8:bg-lime-400/10 v8:text-lime-300 v8light:text-lime-800", text: "v8:text-lime-300 v8light:text-lime-800", bar: "v8:bg-lime-400", edge: "v8:border-l-lime-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-lime-400", icon: "v8:[&_svg]:text-lime-300" },
  win: { fill: "v8:bg-green-400/10 v8:text-green-300 v8light:text-green-800", text: "v8:text-green-300 v8light:text-green-800", bar: "v8:bg-green-400", edge: "v8:border-l-green-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-green-400", icon: "v8:[&_svg]:text-green-300" },
  rose: { fill: "v8:bg-rose-400/10 v8:text-rose-300 v8light:text-rose-800", text: "v8:text-rose-300 v8light:text-rose-800", bar: "v8:bg-rose-400", edge: "v8:border-l-rose-400/70", tint: "v8:bg-transparent", stroke: "v8:stroke-rose-400", icon: "v8:[&_svg]:text-rose-300" },
  neutral: { fill: "v8:bg-ink/[0.08] v8:text-foreground", text: "v8:text-foreground", bar: "v8:bg-ink/30", edge: "v8:border-l-ink/15", tint: "v8:bg-transparent", stroke: "v8:stroke-ink/30", icon: "v8:[&_svg]:text-text-faint" },
} as const satisfies Record<string, Soft>;
export type SoftColour = keyof typeof V8_SOFT;

/** Each meaning's v8 colour, soft (the owner, 11-24: accents, not bold blocks; a count stays the slate-blue accent,
 *  never a warning-like orange): phases by the team page's colours, RP yellow, each award kind its own hue. */
export const MEANING_SOFT: Record<Meaning, SoftColour> = {
  auto: "blue", teleop: "orange", endgame: "green", pen: "red", rp: "yellow",
  inspire: "fuchsia", winning: "amber", finalist: "pink", judged: "grape", performance: "indigo",
  live: "live", upcoming: "accent", finished: "green",
  yes: "green", no: "neutral", count: "accent", reference: "accent", record: "accent",
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
    // RP's "text" is a black-on-yellow chip: in v8 plain words in its yellow, no chip.
    text: `${s.text} ${c.text}${m === "rp" ? " v8:bg-transparent v8:px-0" : ""}`,
    bar: `${s.bar} ${c.bar}`,
    edge: `${s.edge} ${c.edge}`,
    tint: `${s.tint} ${V8_TINT}`,
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
/** v8: the colour a swatch's chip is filled in (to colour its tile's bar, wash and icon the same), if any. Read from
 *  the fill, whose classes are unique per colour (two colours can share a text step: live's and rose's words); when a
 *  swatch was recoloured (its classes appended), the colour written last wins. */
export function softOfFill(fill: string): SoftColour | null {
  const at = (k: SoftColour) => (V8_SOFT[k].fill.split(" ").every((c) => ` ${fill} `.includes(` ${c} `)) ? fill.lastIndexOf(V8_SOFT[k].fill.split(" ")[0]) : -1);
  let best: SoftColour | null = null;
  for (const k of Object.keys(V8_SOFT) as SoftColour[]) if (k !== "neutral" && at(k) >= 0 && (best == null || at(k) > at(best))) best = k;
  return best;
}

/** v8: the category colour a stat's label names (the team page's, owner 11-19), for a one-team card's numbers, which
 *  would otherwise all be the team's slate blue: a phase its own, OPR and a rating purple, a record or a win rate
 *  green, a rank or anything else the accent. */
export function v8Stat(label: string): SoftColour {
  const l = label.toLowerCase();
  // Ranking points before a rank: "ranking" starts with "rank".
  if (/\brp\b|ranking points?/.test(l)) return "yellow";
  if (/\brank(ed|s)?\b|standing|\bplace\b/.test(l)) return "accent";
  if (/\bauto(nomous)?\b/.test(l)) return "blue";
  if (/teleop|driver/.test(l)) return "orange";
  if (/endgame/.test(l)) return "green";
  if (/\bpen(alt(y|ies))?\b|fouls?/.test(l)) return "red";
  if (/\bopr\b|rating|score|points/.test(l)) return "purple";
  if (/record|\bwins?\b|win rate|won/.test(l)) return "win";
  return "accent";
}

/** A tile's v8 classes for a colour: the thin bracket and the icon (on the tile), the value's text. No wash. */
export function v8Tile(c: SoftColour | null) {
  if (!c) return { tile: "v8:border-l-2", value: "" };
  return { tile: `v8:border-l-2 ${V8_SOFT[c].edge} ${V8_SOFT[c].icon}`, value: V8_SOFT[c].text };
}

/** v8: an event's status as a quiet hint (never a banner or a coloured strip): a soft tint chip and a small dot.
 *  Finished a soft green, upcoming the slate-blue accent, live the live red. Wins stay white elsewhere. */
export const V8_STATUS = {
  finished: { chip: "v8:bg-[#8fd3a6]/10 v8:text-[#a9dcba] v8:ring-[#8fd3a6]/25 v8light:bg-[#047857]/10 v8light:text-[#047857] v8light:ring-[#047857]/25", dot: "v8:bg-[#8fd3a6] v8light:bg-[#059669]" },
  upcoming: { chip: "v8:bg-accent/10 v8:text-accent v8:ring-accent/30", dot: "v8:bg-accent" },
  live: { chip: "v8:bg-live/10 v8:text-live v8:ring-live/35", dot: "v8:bg-live" },
} as const;
/** The chip's shape in v8 (a pill with a hairline ring), with V8_STATUS's tint. */
export const V8_STATUS_CHIP = "v8:rounded-full v8:px-2 v8:py-0.5 v8:text-xs v8:font-medium v8:ring-1 v8:ring-inset";
