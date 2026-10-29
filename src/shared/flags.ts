// Runtime feature flags, shared by the server and the web app. One registry, two groups:
// - "feature": the owner console's feature toggles (its Features tab). Every one's routes are gated on the
//   server (403 {error: "feature_disabled", feature}); public team and event data is never behind one.
// - "kill": operational kill switches (live updates, error reports, photos, ...), listed below the toggles.
// Scope "workspace" flags also take per-workspace overrides (migration 53). Resolution: the workspace's
// override, else the global switch, else on. A key that isn't registered here is never gated.
// The server reads them through server/flags.ts (cached for a few seconds), the app through GET /api/flags.

export const FLAGS = [
  "livePredictions", "advancementOdds", "powerRankings", "coinFlips", "offlinePacks", "discordBot", "workspaceScouting",
  "realtime", "errorReporting", "photos", "push", "autoPowerRankings", "dailyPowerRankings", "weeklyDigest",
] as const;
export type Flag = (typeof FLAGS)[number];
export type FlagSet = Record<Flag, boolean>;
export type FlagGroup = "feature" | "kill";
export type FlagScope = "global" | "workspace";

export const isFlag = (x: unknown): x is Flag => typeof x === "string" && (FLAGS as readonly string[]).includes(x);

/** Every flag on: what a fresh server, or one whose flags can't be read, runs with. */
export const DEFAULT_FLAGS: FlagSet = Object.fromEntries(FLAGS.map((f) => [f, true])) as FlagSet;

/** Which group each flag is in, and whether it also takes per-workspace overrides. */
export const FLAG_META: Record<Flag, { group: FlagGroup; scope: FlagScope }> = {
  livePredictions: { group: "feature", scope: "global" },
  advancementOdds: { group: "feature", scope: "global" },
  powerRankings: { group: "feature", scope: "global" },
  coinFlips: { group: "feature", scope: "global" },
  offlinePacks: { group: "feature", scope: "global" },
  discordBot: { group: "feature", scope: "global" },
  workspaceScouting: { group: "feature", scope: "workspace" },
  realtime: { group: "kill", scope: "global" },
  errorReporting: { group: "kill", scope: "global" },
  photos: { group: "kill", scope: "global" },
  push: { group: "kill", scope: "global" },
  autoPowerRankings: { group: "kill", scope: "global" },
  dailyPowerRankings: { group: "kill", scope: "global" },
  weeklyDigest: { group: "kill", scope: "global" },
};

/** The owner console's feature toggles, in the order its Features tab lists them. */
export const FEATURE_FLAGS: readonly Flag[] = FLAGS.filter((f) => FLAG_META[f].group === "feature");
/** The kill switches, listed below the feature toggles. */
export const KILL_SWITCHES: readonly Flag[] = FLAGS.filter((f) => FLAG_META[f].group === "kill");
/** Flags that take per-workspace overrides. */
export const WORKSPACE_FLAGS: readonly Flag[] = FLAGS.filter((f) => FLAG_META[f].scope === "workspace");
export const isWorkspaceFlag = (f: Flag): boolean => FLAG_META[f].scope === "workspace";

/** The error code a gated route answers (403) while its feature is switched off. */
export const FEATURE_DISABLED = "feature_disabled";
/** The 403's body: `feature` is the flag's key. `paused` stays on the offline packs' answer (older apps read it). */
export interface FeatureDisabledBody { error: typeof FEATURE_DISABLED; feature: string; message: string; paused?: true }

/** What a switched-off feature says, on the server's 403 and on the page that shows it. */
export const FEATURE_OFF_MESSAGE: Partial<Record<Flag, string>> = {
  livePredictions: "Live predictions are switched off for now. The track record and every team and event page still work.",
  advancementOdds: "Advancement odds are switched off for now. The rest of this event's page still works.",
  powerRankings: "Power rankings are switched off for now. Every published week is kept and comes back when they do.",
  coinFlips: "Coin flips are switched off for now.",
  offlinePacks: "Offline packs are paused right now. Packs already on this device keep working.",
  discordBot: "The Discord bot is turned off by the owner for now.",
  workspaceScouting: "Workspace scouting is paused by the owner right now. Your entries stay on this device and sync once it's back; personal scouting still syncs.",
};
export const featureOffMessage = (flag: string): string => FEATURE_OFF_MESSAGE[flag as Flag] ?? "This is switched off for now.";

/** What GET /api/flags answers: the global values, and for a signed-in account its workspaces' resolved workspace flags. */
export interface FlagsAnswer { flags: FlagSet; workspaces?: Record<string, Partial<FlagSet>> }

/** What each switch does, for the owner console. `pending`: the feature it guards hasn't shipped yet, so
 *  the switch is stored but nothing reads it (said in the console, never implied otherwise). */
export const FLAG_INFO: Record<Flag, { label: string; on: string; off: string; pending?: string }> = {
  livePredictions: {
    label: "Live predictions",
    on: "Anyone can ask for a match prediction, the upcoming matches list, an event forecast, partner scenarios and match share cards.",
    off: "Those calls answer that predictions are switched off for now, and Predict says so. The track record and every logged prediction are kept, and team and event pages still load.",
  },
  advancementOdds: {
    label: "Advancement odds",
    on: "Event pages show the simulated advancement odds (the Odds tab), updated live during the event.",
    off: "The Odds tab says the odds are switched off for now, and the odds and their live stream are refused. The simulations keep running, so switching back on shows the latest at once.",
  },
  powerRankings: {
    label: "Power rankings publishing",
    on: "The Power rankings page shows the published weeks, and new weeks are published (automatically, or with Publish now).",
    off: "The Power rankings page says they're switched off for now, nothing new is published and the automatic job skips. Every published week is kept and shows again when switched back on; this console still lists them.",
  },
  coinFlips: {
    label: "Coin flips",
    on: "Home shows today's coin flips: the matches the model rates closest to 50-50.",
    off: "Home leaves the coin flips out and the radar is refused. It keeps being gathered, so switching back on shows today's at once.",
  },
  realtime: {
    label: "Live updates stream",
    on: "Members looking at a workspace's scout entries see new ones arrive live.",
    off: "No live connections are accepted; the entry list refreshes every few seconds instead.",
  },
  workspaceScouting: {
    label: "Workspace scouting",
    on: "Members of a Control Point workspace share scout entries.",
    off: "Shared entries pause (devices keep them queued until it's back on); everyone's personal scouting keeps working.",
  },
  errorReporting: {
    label: "Error reports",
    on: "The app offers to report crashes, and Settings has a bug report box.",
    off: "The app stops asking, and any report that still arrives is accepted and dropped.",
  },
  offlinePacks: {
    label: "Offline pack auto-updates",
    on: "Returning visitors get the offline prediction pack in the background, and Download lists every pack.",
    off: "No background downloads, and the pack files answer that packs are paused.",
  },
  discordBot: {
    label: "Discord bot",
    on: "The Control Scout Discord bot answers its commands and posts alerts for the teams and events each server follows (needs DISCORD_BOT_TOKEN).",
    off: "The bot answers every command with a short note that it's turned off by the owner, and posts nothing. Every server's follows are kept, so switching back on resumes them.",
  },
  photos: {
    label: "Entry photos",
    on: "Workspace members attach photos to scout entries (needs the R2 settings on the server; without them photos stay hidden either way).",
    off: "The photo buttons and thumbnails disappear and new uploads are refused. Stored photos stay, and still expire after their event.",
  },
  push: {
    label: "Push notifications",
    on: "Signed-in devices that turned notifications on get match reminders, upsets and event starts for the teams and events they follow (needs the VAPID settings on the server; without them push stays off either way).",
    off: "Nothing is sent and Settings stops offering to turn notifications on. Devices stay subscribed, so switching back on resumes them.",
  },
  autoPowerRankings: {
    label: "Automatic power rankings",
    on: "Every Friday at 00:00 New York time, a new top 25 is published from the live world ranking, with blurbs by Bruno (Control Point's AI), fact-checked against the week's data.",
    off: "No new weeks are generated, Publish now is refused, and the daily refresh stops. Weeks already published stay up (hide them one by one under Power rankings).",
  },
  dailyPowerRankings: {
    label: "Daily power rankings refresh",
    on: "Every day at 00:00 New York time, the current automatic week is checked against the latest data. If nothing shown changed, only its Updated date moves; otherwise the changed entries are updated, and Bruno rewrites only the blurbs of teams whose place changed.",
    off: "The current week stays exactly as it was published (or last refreshed) until next Friday's week replaces it.",
  },
  weeklyDigest: {
    label: "Weekly email digest",
    on: "Every Monday at 8:00 New York time, people who turned on the weekly digest get one email with their followed teams' results, the prediction check-in and upcoming events (needs RESEND_API_KEY; without it nothing is sent either way).",
    off: "No digests are sent and Settings stops offering to turn it on. Everyone's choice is kept, so switching back on resumes the next Monday.",
  },
};
