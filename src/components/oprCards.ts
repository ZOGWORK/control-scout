// The OPR tiles' names, icons and colours: the team page's Offensive power rating section and search's OPR answer
// (search/page/StatAnswer.tsx) both draw from this one list, so the two read as the same card.
import { Flag, Gauge, Target, Zap } from "lucide-react";
import type { OprPhase } from "../shared/searchStat";
import { rankPct } from "../shared/format";
import { TONES, type Tone } from "./StatTile";

export const OPR_CARDS = [["np", "Total OPR", Target, "accent"], ["auto", "Autonomous", Zap, "sky"], ["teleop", "TeleOp", Gauge, "emerald"], ["endgame", "Endgame", Flag, "violet"]] as const satisfies readonly (readonly [OprPhase, string, unknown, Tone])[];
export const OPR_TONE: Record<string, Tone> = Object.fromEntries(OPR_CARDS.map(([k, , , tone]) => [k, tone]));
/** Every scoring phase's colour as the team page draws it, for search's phase tiles too (the owner, 11-05: Auto blue,
 *  TeleOp green, Endgame purple, penalties red, ranking points yellow, over the guide's "hue means team"). */
export const PHASE_TONE: Record<string, Tone> = { ...OPR_TONE, pen: "rose", rp: "accent" };
/** A phase's number in its colour on its own tinted tile: the tone's text, one step darker for penalties on Light
 *  (rose 600 is 4.15:1 on its tint; rose 700 clears 4.5:1). */
export const PHASE_TEXT = (k: string) => (k === "pen" ? "text-rose-700 dark:text-rose-400" : TONES[PHASE_TONE[k] ?? "neutral"].text);
/** The phase a tile's label names ("Auto", "TeleOp + end", "Pen given", "Avg RP"), or null. A score said without or
 *  before penalties ("Without penalties") is a total, not the penalty points. */
export function phaseOfLabel(label: string): string | null {
  return /\bauto/i.test(label) ? "auto" : /teleop/i.test(label) ? "teleop" : /endgame/i.test(label) ? "endgame"
    : /\bpen(alt|\.|\b)/i.test(label) && !/\b(without|before|no|excluding)\s+pen/i.test(label) ? "pen" : /\bRP\b|ranking points?/i.test(label) ? "rp" : null;
}

/** A tile's rank line, as the team page words it: "OPR #612 of 8,308 with an OPR · top 8%". */
export function oprRankHint(rank: number | null | undefined, of: number | null | undefined): string {
  const top = rankPct(rank, of);
  return `${rank ? `OPR #${rank.toLocaleString()} of ${of?.toLocaleString()} with an OPR` : "Unranked"}${top ? ` · ${top}` : ""}`;
}
