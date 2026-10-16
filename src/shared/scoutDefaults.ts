// The built-in scout templates: the fields a match or pit entry asks for when
// no workspace template applies (Personal, and any workspace that hasn't
// customised that kind for the season). Shared so the server can use them too
// (the workspace CSV export: server/scout/export.ts).
import type { ScoutField, ScoutTemplate } from "./scoutTemplate";

const common: ScoutField[] = [
  { id: "defense", label: "Played defense", type: "toggle", phase: "teleop" },
  { id: "broke", label: "Broke down / disabled", type: "toggle", phase: "overall" },
  { id: "fouls", label: "Fouls drawn", type: "counter", phase: "overall", max: 20 },
  { id: "driver", label: "Driver skill", type: "rating", phase: "overall", max: 5 },
  { id: "consistency", label: "Consistency", type: "rating", phase: "overall", max: 5 },
];

const MATCH: Record<number, ScoutField[]> = {
  2026: [
    { id: "autoLeave", label: "Left start zone", type: "toggle", phase: "auto" },
    { id: "autoPark", label: "Parked in auto", type: "toggle", phase: "auto" },
    { id: "autoHive", label: "Hive tips (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "pollen", label: "Pollen / nectar scored", type: "counter", phase: "teleop", max: 60 },
    { id: "garden", label: "Garden scoring", type: "counter", phase: "teleop", max: 40 },
    { id: "teleHive", label: "Hive tips (TeleOp)", type: "counter", phase: "teleop", max: 10 },
    { id: "park", label: "End park", type: "choice", phase: "endgame", options: ["None", "Partial", "Full"] },
  ],
  2025: [
    { id: "autoLeave", label: "Left launch line", type: "toggle", phase: "auto" },
    { id: "autoArtifacts", label: "Artifacts classified (auto)", type: "counter", phase: "auto", max: 20 },
    { id: "autoPattern", label: "Matched the pattern (auto)", type: "toggle", phase: "auto" },
    { id: "artifacts", label: "Artifacts classified (TeleOp)", type: "counter", phase: "teleop", max: 60 },
    { id: "overflow", label: "Overflow artifacts", type: "counter", phase: "teleop", max: 40 },
    { id: "base", label: "Returned to base", type: "choice", phase: "endgame", options: ["None", "Partial", "Full"] },
  ],
  2024: [
    { id: "autoSamples", label: "Samples (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "autoSpecimens", label: "Specimens (auto)", type: "counter", phase: "auto", max: 10 },
    { id: "samples", label: "Samples (TeleOp)", type: "counter", phase: "teleop", max: 40 },
    { id: "specimens", label: "Specimens (TeleOp)", type: "counter", phase: "teleop", max: 40 },
    { id: "ascent", label: "Ascent", type: "choice", phase: "endgame", options: ["None", "Park", "Level 1", "Level 2", "Level 3"] },
  ],
  2023: [
    { id: "purple", label: "Purple pixel on spike mark", type: "toggle", phase: "auto" },
    { id: "yellow", label: "Yellow pixel on backdrop", type: "toggle", phase: "auto" },
    { id: "pixels", label: "Pixels placed (TeleOp)", type: "counter", phase: "teleop", max: 80 },
    { id: "mosaics", label: "Mosaics", type: "counter", phase: "teleop", max: 10 },
    { id: "drone", label: "Drone launched", type: "toggle", phase: "endgame" },
    { id: "hang", label: "Suspended", type: "toggle", phase: "endgame" },
  ],
};

const PIT: ScoutField[] = [
  { id: "drivetrain", label: "Drivetrain", type: "choice", phase: "pit", options: ["Mecanum", "Tank", "Swerve", "Other"] },
  { id: "autoRoutines", label: "Auto routines", type: "counter", phase: "pit", max: 10 },
  { id: "preferredStart", label: "Preferred start", type: "choice", phase: "pit", options: ["Near", "Far", "Either"] },
  { id: "endgameCapable", label: "Can do the endgame", type: "toggle", phase: "pit" },
  { id: "canDefend", label: "Willing to play defense", type: "toggle", phase: "pit" },
  { id: "weight", label: "Robot weight (lb)", type: "counter", phase: "pit", max: 60 },
];

/** The built-in default template (Personal, and any workspace that hasn't customised that kind). */
export function builtinTemplate(season: number, kind: "match" | "pit"): ScoutTemplate {
  if (kind === "pit") return { id: `pit`, kind, name: "Pit scouting", fields: PIT, version: 0 };
  const fields = MATCH[season] ?? [
    { id: "autoScore", label: "Auto scoring", type: "rating", phase: "auto", max: 5 },
    { id: "teleScore", label: "TeleOp scoring", type: "rating", phase: "teleop", max: 5 },
    { id: "endgame", label: "Endgame", type: "rating", phase: "endgame", max: 5 },
  ];
  return { id: `match-${season}`, kind, name: "Match scouting", fields: [...fields, ...common], version: 0 };
}
