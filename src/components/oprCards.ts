// The OPR tiles' names, icons and colours: the team page's Offensive power rating section and search's OPR answer
// (search/page/StatAnswer.tsx) both draw from this one list, so the two read as the same card.
import { Flag, Gauge, Target, Zap } from "lucide-react";
import type { OprPhase } from "../shared/searchStat";
import { rankPct } from "../shared/format";
import type { Tone } from "./StatTile";

export const OPR_CARDS = [["np", "Total OPR", Target, "accent"], ["auto", "Autonomous", Zap, "sky"], ["teleop", "TeleOp", Gauge, "emerald"], ["endgame", "Endgame", Flag, "violet"]] as const satisfies readonly (readonly [OprPhase, string, unknown, Tone])[];
export const OPR_TONE: Record<string, Tone> = Object.fromEntries(OPR_CARDS.map(([k, , , tone]) => [k, tone]));

/** A tile's rank line, as the team page words it: "OPR #612 of 8,308 with an OPR · top 8%". */
export function oprRankHint(rank: number | null | undefined, of: number | null | undefined): string {
  const top = rankPct(rank, of);
  return `${rank ? `OPR #${rank.toLocaleString()} of ${of?.toLocaleString()} with an OPR` : "Unranked"}${top ? ` · ${top}` : ""}`;
}
