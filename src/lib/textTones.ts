// Coloured text that has to stay readable: each tone keeps its bright fill (the tint behind a chip, a card's
// stripe) and takes a text colour that reaches WCAG AA on it in both themes. On light the text is a shade or
// two deeper than the fill (sky 700 on a sky 400 tint); on dark it stays the bright shade. The semantic
// tokens (text-info, text-success, text-danger, text-accent-text) already do that switch in src/index.css.
// textTones.test.ts measures every pair here against the card in both themes.

/** An event's status chip (Events list cards). */
export const EVENT_STATUS_TONE = {
  live: "bg-red-500/15 text-danger",
  upcoming: "bg-sky-400/15 text-info",
  finished: "bg-emerald-400/15 text-success",
} as const;

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

/** The chips beside each team on an event's Teams tab: npOPR and the win-loss-tie record. */
export const ROSTER_CHIP_TONE = {
  npOpr: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  record: "bg-green-500/12 text-success",
} as const;

/** The Records table's Compare-cap note (amber 600 on its own tint was 3:1 on light). */
export const RECORDS_CAP_NOTE_TONE = "bg-amber-500/10 text-amber-800 dark:text-amber-400";

/** The count on each Events status filter chip: the chip's own muted text, no extra fade (opacity 70 took it under 4.5:1). */
export const EVENT_FILTER_COUNT = "font-normal tabular-nums";

/** A team's worldwide percentile ("Top 8%") in its profile hero, on the hero's secondary panel. */
export const PROFILE_PERCENTILE_TEXT = "text-accent-text";

/** Chart legends (ChartContainer): each label in the foreground colour, its swatch keeping the series colour. */
export const CHART_LEGEND_TEXT = "[&_.recharts-legend-item-text]:!text-foreground";
