// The engine's public version history (How it works › Version history): one plain line per release,
// newest first. Every engine release adds its line in the same PR (the doc-with-code rule); a test checks
// the newest entry is the running engine and that every release in the engine's CHANGELOG is here.

export interface EngineVersionNote {
  version: string;
  /** Release date (YYYY-MM-DD), as in packages/predict-engine/CHANGELOG.md. */
  date: string;
  /** One plain-language line: what changed for someone reading predictions. */
  line: string;
  /** True when the release moved win probabilities or scores (false: same numbers, new words or plumbing). */
  numbers: boolean;
}

export const ENGINE_VERSIONS: EngineVersionNote[] = [
  { version: "3.0.0", date: "2026-10-23", numbers: false, line: "Prediction Engine 3.0: the 2.7–2.11 changes, re-checked on every season since 2019–20 (truer chances in six of seven). Same numbers as 2.11." },
  { version: "2.11.0", date: "2026-10-23", numbers: true, line: "Two robots strong at the same thing score a bit less together in quals (overlap in auto and TeleOp); first-event calls improved most." },
  { version: "2.10.0", date: "2026-10-23", numbers: true, line: "A robot's foul rating learns slowly: fouls are mostly luck, so foul-prone teams are no longer charged for huge penalty totals." },
  { version: "2.9.0", date: "2026-10-23", numbers: true, line: "The model watches today's matches too: a robot beating its rating at an event leans its next odds there." },
  { version: "2.8.0", date: "2026-10-23", numbers: true, line: "Win chances are stretched slightly away from 50%: the engine had been a little too cautious." },
  { version: "2.7.0", date: "2026-10-22", numbers: true, line: "Teams new to a season start from their region's form as well as their history; last season counts a little more." },
  { version: "2.6.0", date: "2026-10-21", numbers: true, line: "Event simulations spread erratic robots wider and never peek at later results before an event." },
  { version: "2.5.0", date: "2026-10-21", numbers: false, line: "Predictions name notable no-shows and near-zero matches in their reasons. Same numbers." },
  { version: "2.4.0", date: "2026-10-21", numbers: false, line: "Predictions show the strongest real history between the robots (played together or against). Same numbers." },
  { version: "2.3.0", date: "2026-10-21", numbers: true, line: "Bonus ranking point odds for every qualification match." },
  { version: "2.2.0", date: "2026-10-21", numbers: false, line: "Every predicted score gets an 80% range. Win odds unchanged." },
  { version: "2.1.1", date: "2026-10-17", numbers: false, line: "Each live call also records the previous model's odds, so versions can be compared on the same matches. Same numbers." },
  { version: "2.1.0", date: "2026-10-17", numbers: true, line: "Form at the current event, momentum and recent collapses feed the win probability." },
  { version: "2.0.0", date: "2026-10-16", numbers: true, line: "A learned correction of the win probability from match context and each robot's track record." },
  { version: "1.1.0", date: "2026-10-13", numbers: true, line: "Simulated playoff alliances of three field their two strongest robots, not all three." },
  { version: "1.0.0", date: "2026-10-12", numbers: false, line: "The engine moves into its own package shared by Control Scout and Control Point, bit for bit." },
];
