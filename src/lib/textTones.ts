// Coloured text that has to stay readable: each tone keeps its bright fill (the tint behind a chip, a card's
// stripe) and takes a text colour that reaches WCAG AA on it in both themes. On light the text is a shade or
// two deeper than the fill (sky 700 on a sky 400 tint); on dark it stays the bright shade. The semantic
// tokens (text-info, text-success, text-danger, text-accent-text) already do that switch in src/index.css.
// textTones.test.ts measures every pair here against the card in both themes.

/** An event's status chip (Events list cards). */
export const EVENT_STATUS_TONE = {
  live: "bg-danger/15 text-danger",
  upcoming: "bg-sky-400/15 text-info",
  finished: "bg-emerald-400/15 text-success",
} as const;

/** Event status at full strength, where status is what a block is about (search's championship tree,
 *  components/search/page/EventTree.tsx): a solid chip (`chip`, white on a deep fill, AA), the block's thick bar and the
 *  dot on its divisions count (`bar`), the tree's connector and nodes (`line`, `tick`), and a node's tinted icon
 *  chip (`tint`, `icon`, a graphic: 3:1). The status families of search's palette (SEARCH_PALETTE live, upcoming,
 *  finished: rose, cyan, lime), so a status never shares a colour with a phase, a team or an award on a search card. */
export const EVENT_STATUS_SOLID = {
  live: { chip: "bg-rose-700 text-white", bar: "bg-rose-600", line: "border-rose-600", tick: "before:bg-rose-600", tint: "bg-rose-600/12", icon: "text-rose-700 dark:text-rose-400" },
  upcoming: { chip: "bg-cyan-700 text-white", bar: "bg-cyan-700 dark:bg-cyan-500", line: "border-cyan-700 dark:border-cyan-500", tick: "before:bg-cyan-700 dark:before:bg-cyan-500", tint: "bg-cyan-600/12", icon: "text-cyan-700 dark:text-cyan-400" },
  finished: { chip: "bg-lime-700 text-white", bar: "bg-lime-700 dark:bg-lime-500", line: "border-lime-700 dark:border-lime-500", tick: "before:bg-lime-700 dark:before:bg-lime-500", tint: "bg-lime-600/12", icon: "text-lime-700 dark:text-lime-400" },
} as const;

/** Video and recordings (Has a recording, Clips, a match's Watch chip): the one video red, as text or on its own tint. */
export const VIDEO_TONE = { text: "text-video", chip: "bg-video/12 text-video" } as const;

/** Colour per event type: the stripe on each Events card (`bar`, a fill) and its type label (`text`). */
export const EVENT_TYPE_TONE: Record<string, { bar: string; text: string }> = {
  Qualifier: { bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  LeagueMeet: { bar: "bg-sky-400", text: "text-sky-700 dark:text-sky-400" },
  LeagueTournament: { bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  SuperQualifier: { bar: "bg-orange-400", text: "text-orange-700 dark:text-orange-400" },
  Championship: { bar: "bg-accent", text: "text-accent-text" },
  FIRSTChampionship: { bar: "bg-accent", text: "text-accent-text" },
  Premier: { bar: "bg-pink-400", text: "text-pink-700 dark:text-pink-400" },
};

/** The neutral fill behind an event's type chip in its page header (components/EventChips.tsx), under the type's `text`. */
export const EVENT_TYPE_CHIP_FILL = "bg-text-base/[0.07]";

/** The chips beside each team on an event's Teams tab: npOPR and the win-loss-tie record. */
export const ROSTER_CHIP_TONE = {
  npOpr: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  record: "bg-green-500/12 text-success",
} as const;

/** The Records table's Compare-cap note (amber 600 on its own tint was 3:1 on light). */
export const RECORDS_CAP_NOTE_TONE = "bg-amber-500/10 text-accent-text";

/** The count on each Events status filter chip: the chip's own muted text, no extra fade (opacity 70 took it under 4.5:1). */
export const EVENT_FILTER_COUNT = "font-normal tabular-nums";

/** A team's worldwide percentile ("Top 8%"), 48px display text: the accent itself, the owner's large-text exception on light. */
export const PROFILE_PERCENTILE_TEXT = "text-accent-display";

/** Chart legends (ChartContainer): each label in the foreground colour, its swatch keeping the series colour. */
export const CHART_LEGEND_TEXT = "[&_.recharts-legend-item-text]:!text-foreground";

/** Compared teams' hues in search answers (the search results guide: hue means team, nothing else): team A, B and C
 *  as bar fills and swatches, never as text (values are printed in the foreground). At most three per card; a fourth
 *  team gets the neutral ink. Tokens in index.css (--color-team-*). */
export const TEAM_FILL = ["bg-team-a", "bg-team-b", "bg-team-c"] as const;
export const teamFill = (i: number) => TEAM_FILL[i] ?? "bg-foreground/50";

/** A place's chip in search lists (rank pills, the leaderboard's top three, match boxes): filled in the team hue, the
 *  medal icon beside it saying podium (never gold: yellow is ranking points'). */
export const PODIUM_CHIP: Record<number, string> = {
  1: "bg-team-a text-background",
  2: "bg-team-a text-background",
  3: "bg-team-a text-background",
};

/** Search answers' one palette (the owner's brief, 11-06: colour is the first signal, exaggerated, the same meaning the
 *  same colour on every card, no two meanings sharing a hue). Each meaning has its own Tailwind family and:
 *  `fill` a saturated chip or tile head with text on it (white, or black on yellow), `text` the colour as text on the
 *  card (a deep shade on Light, a bright one on dark themes), `bar` a graphic fill, `edge` a thick left bar's colour,
 *  `tint` a pale wash behind a tile. textTones.test.ts holds every fill and text to 4.5:1 in every theme and every
 *  family to one meaning. Teams keep their own tokens (team A, B, C: --color-team-*). RP is the only yellow, and only
 *  as a fill, its text a black-on-yellow chip (no light yellow text on dark). */
// Literal class names (Tailwind only generates classes it can see written out).
export const SEARCH_PALETTE = {
  // Scoring phases.
  auto: { family: "blue", label: "Auto", fill: "bg-blue-600 text-white", text: "text-blue-700 dark:text-blue-400", bar: "bg-blue-600 dark:bg-blue-500", edge: "border-l-blue-600 dark:border-l-blue-500", tint: "bg-blue-500/10", stroke: "stroke-blue-600 dark:stroke-blue-500" },
  teleop: { family: "emerald", label: "TeleOp", fill: "bg-emerald-700 text-white", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-700 dark:bg-emerald-500", edge: "border-l-emerald-700 dark:border-l-emerald-500", tint: "bg-emerald-500/10", stroke: "stroke-emerald-700 dark:stroke-emerald-500" },
  endgame: { family: "violet", label: "Endgame", fill: "bg-violet-600 text-white", text: "text-violet-700 dark:text-violet-400", bar: "bg-violet-600 dark:bg-violet-500", edge: "border-l-violet-600 dark:border-l-violet-500", tint: "bg-violet-500/10", stroke: "stroke-violet-600 dark:stroke-violet-500" },
  pen: { family: "red", label: "Penalties", fill: "bg-red-700 text-white", text: "text-red-700 dark:text-red-400", bar: "bg-red-700 dark:bg-red-500", edge: "border-l-red-700 dark:border-l-red-500", tint: "bg-red-500/10", stroke: "stroke-red-700 dark:stroke-red-500" },
  rp: { family: "yellow", label: "Ranking points", fill: "bg-yellow-400 text-black", text: "rounded bg-yellow-400 px-1 text-black", bar: "bg-yellow-700 dark:bg-yellow-400", edge: "border-l-yellow-700 dark:border-l-yellow-400", tint: "bg-yellow-500/10", stroke: "stroke-yellow-700 dark:stroke-yellow-400" },
  // Awards: the Inspire, the alliances' places, the other judged and performance awards.
  inspire: { family: "fuchsia", label: "Inspire", fill: "bg-fuchsia-700 text-white", text: "text-fuchsia-700 dark:text-fuchsia-400", bar: "bg-fuchsia-700 dark:bg-fuchsia-500", edge: "border-l-fuchsia-700 dark:border-l-fuchsia-500", tint: "bg-fuchsia-500/10", stroke: "stroke-fuchsia-700 dark:stroke-fuchsia-500" },
  winning: { family: "orange", label: "Winning Alliance", fill: "bg-orange-700 text-white", text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-700 dark:bg-orange-500", edge: "border-l-orange-700 dark:border-l-orange-500", tint: "bg-orange-500/10", stroke: "stroke-orange-700 dark:stroke-orange-500" },
  finalist: { family: "pink", label: "Finalist Alliance", fill: "bg-pink-700 text-white", text: "text-pink-700 dark:text-pink-400", bar: "bg-pink-700 dark:bg-pink-500", edge: "border-l-pink-700 dark:border-l-pink-500", tint: "bg-pink-500/10", stroke: "stroke-pink-700 dark:stroke-pink-500" },
  judged: { family: "teal", label: "Judged award", fill: "bg-teal-700 text-white", text: "text-teal-700 dark:text-teal-400", bar: "bg-teal-700 dark:bg-teal-500", edge: "border-l-teal-700 dark:border-l-teal-500", tint: "bg-teal-500/10", stroke: "stroke-teal-700 dark:stroke-teal-500" },
  performance: { family: "indigo", label: "Performance award", fill: "bg-indigo-600 text-white", text: "text-indigo-700 dark:text-indigo-400", bar: "bg-indigo-600 dark:bg-indigo-500", edge: "border-l-indigo-600 dark:border-l-indigo-500", tint: "bg-indigo-500/10", stroke: "stroke-indigo-600 dark:stroke-indigo-500" },
  // An event's status.
  live: { family: "rose", label: "Live", fill: "bg-rose-700 text-white", text: "text-rose-700 dark:text-rose-400", bar: "bg-rose-700 dark:bg-rose-500", edge: "border-l-rose-700 dark:border-l-rose-500", tint: "bg-rose-500/10", stroke: "stroke-rose-700 dark:stroke-rose-500" },
  upcoming: { family: "cyan", label: "Upcoming", fill: "bg-cyan-700 text-white", text: "text-cyan-700 dark:text-cyan-400", bar: "bg-cyan-700 dark:bg-cyan-500", edge: "border-l-cyan-700 dark:border-l-cyan-500", tint: "bg-cyan-500/10", stroke: "stroke-cyan-700 dark:stroke-cyan-500" },
  finished: { family: "lime", label: "Finished", fill: "bg-lime-700 text-white", text: "text-lime-700 dark:text-lime-400", bar: "bg-lime-700 dark:bg-lime-500", edge: "border-l-lime-700 dark:border-l-lime-500", tint: "bg-lime-500/10", stroke: "stroke-lime-700 dark:stroke-lime-500" },
  // A yes-or-no question's answer (components/search/page/Verdict.tsx): green yes; no in slate, red being penalties'.
  yes: { family: "green", label: "Yes", fill: "bg-green-700 text-white", text: "text-green-700 dark:text-green-400", bar: "bg-green-700 dark:bg-green-500", edge: "border-l-green-700 dark:border-l-green-500", tint: "bg-green-500/10", stroke: "stroke-green-700 dark:stroke-green-500" },
  no: { family: "slate", label: "No", fill: "bg-slate-700 text-white", text: "text-slate-700 dark:text-slate-300", bar: "bg-slate-700 dark:bg-slate-400", edge: "border-l-slate-700 dark:border-l-slate-400", tint: "bg-slate-500/10", stroke: "stroke-slate-700 dark:stroke-slate-400" },
} as const;
export type Meaning = keyof typeof SEARCH_PALETTE;

/** The meaning a label names, read the same way on every card: a phase ("Auto", "TeleOp + end", "Pen given", "Avg
 *  RP"), an award ("Inspire Award 2nd Place", "1st place (Winning Alliance)", "Think"), a status. Null: none (the
 *  card's team hue then). */
export function meaningOf(label: string): Meaning | null {
  const l = label.toLowerCase();
  if (/inspire/.test(l)) return "inspire";
  if (/winning alliance|winner/.test(l)) return "winning";
  if (/finalist/.test(l)) return "finalist";
  if (/\b(think|connect|innovate|design|motivate|control|reach|sustain|judges|dean|compass|promote|team spirit)\b/.test(l)) return "judged";
  if (/\bjudged\b/.test(l)) return "judged";
  if (/\bperformance\b/.test(l)) return "performance";
  if (/\bauto(nomous)?\b/.test(l)) return "auto";
  if (/teleop|driver/.test(l)) return "teleop";
  if (/endgame/.test(l)) return "endgame";
  if (/\bpen(alt(y|ies))?\b|\bpen\.|fouls?/.test(l) && !/\b(without|before|no|excluding)\s+pen/.test(l)) return "pen";
  if (/\brp\b|ranking points?/.test(l)) return "rp";
  if (/^live\b/.test(l)) return "live";
  if (/^upcoming\b/.test(l)) return "upcoming";
  if (/^(finished|final|done)\b/.test(l)) return "finished";
  return null;
}
