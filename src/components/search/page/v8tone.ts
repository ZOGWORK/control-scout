// v8 (docs/design/v8-revamp-brief.md §3.1, §5 Charts): search answers go neutral. Every palette entry keeps its
// v8-off classes and gains `v8:` ones after them, so v8 off draws exactly as before and v8 on draws:
//   fill  a white/8% chip with foreground text (no coloured fill behind text);
//   text  the foreground (no coloured words);
//   bar   a grey step (phases keep distinct steps so a stacked bar still reads), mint only for the highlight series;
//   edge  a hairline; tint nothing; stroke grey.
// The `v8` variant is registered after `dark` (src/index.css), so it wins over `dark:` classes of the same property.
import { SEARCH_PALETTE, type Meaning } from "../../../lib/textTones";

type Tone = { family: string; label: string; fill: string; text: string; bar: string; edge: string; tint: string; stroke: string };

/** A phase's grey in a stacked bar (auto, teleop, endgame, penalties): one step each, lightest first. */
const STEP: Partial<Record<Meaning, string>> = {
  auto: "v8:bg-white/60",
  teleop: "v8:bg-white/40",
  endgame: "v8:bg-white/25",
  pen: "v8:bg-white/15",
};
const STROKE: Partial<Record<Meaning, string>> = {
  auto: "v8:stroke-white/60",
  teleop: "v8:stroke-white/40",
  endgame: "v8:stroke-white/25",
  pen: "v8:stroke-white/15",
};

export const V8_FILL = "v8:bg-white/[0.08] v8:text-foreground";
export const V8_TEXT = "v8:text-foreground";
export const V8_BAR = "v8:bg-white/30";
export const V8_EDGE = "v8:border-l-white/15";
export const V8_TINT = "v8:bg-transparent";
export const V8_STROKE = "v8:stroke-white/30";

/** One swatch made calm in v8 (the v8-off classes first, untouched). */
export function calm<T extends { fill: string; text: string; bar: string; edge: string; tint: string; stroke: string }>(s: T, m?: Meaning): T {
  return {
    ...s,
    fill: `${s.fill} ${V8_FILL}`,
    // RP's "text" is a black-on-yellow chip: in v8 plain foreground words, no chip.
    text: `${s.text} ${V8_TEXT}${m === "rp" ? " v8:bg-transparent v8:px-0" : ""}`,
    bar: `${s.bar} ${(m && STEP[m]) ?? V8_BAR}`,
    edge: `${s.edge} ${V8_EDGE}`,
    tint: `${s.tint} ${V8_TINT}`,
    stroke: `${s.stroke} ${(m && STROKE[m]) ?? V8_STROKE}`,
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

/** v8: an event's status as a quiet hint (never a banner or a coloured strip): a soft tint chip and a small dot.
 *  Finished a soft green, upcoming the slate-blue accent, live the live red. Wins stay white elsewhere. */
export const V8_STATUS = {
  finished: { chip: "v8:bg-[#8fd3a6]/10 v8:text-[#a9dcba] v8:ring-[#8fd3a6]/25", dot: "v8:bg-[#8fd3a6]" },
  upcoming: { chip: "v8:bg-accent/10 v8:text-accent v8:ring-accent/30", dot: "v8:bg-accent" },
  live: { chip: "v8:bg-live/10 v8:text-live v8:ring-live/35", dot: "v8:bg-live" },
} as const;
/** The chip's shape in v8 (a pill with a hairline ring), with V8_STATUS's tint. */
export const V8_STATUS_CHIP = "v8:rounded-full v8:px-2 v8:py-0.5 v8:text-xs v8:font-medium v8:ring-1 v8:ring-inset";
