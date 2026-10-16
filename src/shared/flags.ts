// Runtime feature flags (kill switches), shared by the server and the web app.
// The owner turns them on and off in the owner portal (/owner); the server
// reads them through server/flags.ts (cached for a few seconds) and the app
// through GET /api/flags. Every flag is on unless the owner turned it off.

export const FLAGS = ["realtime", "workspaceScouting", "errorReporting", "offlinePacks", "photos", "push"] as const;
export type Flag = (typeof FLAGS)[number];
export type FlagSet = Record<Flag, boolean>;

export const isFlag = (x: unknown): x is Flag => typeof x === "string" && (FLAGS as readonly string[]).includes(x);

/** Every flag on: what a fresh server, or one whose flags can't be read, runs with. */
export const DEFAULT_FLAGS: FlagSet = { realtime: true, workspaceScouting: true, errorReporting: true, offlinePacks: true, photos: true, push: true };

/** What each switch does, for the owner portal. `pending`: the feature it guards hasn't shipped yet, so
 *  the switch is stored but nothing reads it (said in the portal, never implied otherwise). */
export const FLAG_INFO: Record<Flag, { label: string; on: string; off: string; pending?: string }> = {
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
    label: "Offline packs",
    on: "Returning visitors get the offline prediction pack in the background, and Download lists every pack.",
    off: "No background downloads, and the pack files answer that packs are paused.",
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
};
