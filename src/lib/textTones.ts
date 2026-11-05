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

/** Teams side by side in a search comparison (head-to-head tables, the two-team header): each team its own theme
 *  colour, never yellow or blue (the owner's call) and never red or blue (those are alliances). Teal, then orange, then
 *  violet; text a shade deeper on light so a bold value reaches AA on the card. */
export const COMPARE_SIDE_TONE = [
  { text: "text-teal-700 dark:text-teal-400", chip: "bg-teal-500/12 text-teal-700 dark:text-teal-400", dot: "bg-teal-500", edge: "border-t-teal-500", box: "border-teal-500/30 bg-teal-500/[0.06]" },
  { text: "text-orange-700 dark:text-orange-400", chip: "bg-orange-500/12 text-orange-700 dark:text-orange-400", dot: "bg-orange-500", edge: "border-t-orange-500", box: "border-orange-500/30 bg-orange-500/[0.06]" },
  { text: "text-violet-700 dark:text-violet-400", chip: "bg-violet-500/12 text-violet-700 dark:text-violet-400", dot: "bg-violet-500", edge: "border-t-violet-500", box: "border-violet-500/30 bg-violet-500/[0.06]" },
  { text: "text-pink-700 dark:text-pink-400", chip: "bg-pink-500/12 text-pink-700 dark:text-pink-400", dot: "bg-pink-500", edge: "border-t-pink-500", box: "border-pink-500/30 bg-pink-500/[0.06]" },
] as const;

/** A place's chip in search lists (rank pills, the leaderboard's top three, match boxes): 1st green, 2nd blue, 3rd
 *  orange, the search podium's colours, each reaching AA on its tint. */
export const PODIUM_CHIP: Record<number, string> = {
  1: "bg-success/15 text-success",
  2: "bg-info/15 text-info",
  3: "bg-orange-500/15 text-orange-800 dark:text-orange-400",
};
