// Runtime feature flags (kill switches), shared by the server and the web app.
// The owner turns them on and off in the owner portal (/owner); the server
// reads them through server/flags.ts (cached for a few seconds) and the app
// through GET /api/flags. Every flag is on unless the owner turned it off.

export const FLAGS = ["realtime", "workspaceScouting", "errorReporting", "offlinePacks"] as const;
export type Flag = (typeof FLAGS)[number];
export type FlagSet = Record<Flag, boolean>;

export const isFlag = (x: unknown): x is Flag => typeof x === "string" && (FLAGS as readonly string[]).includes(x);

/** Every flag on: what a fresh server, or one whose flags can't be read, runs with. */
export const DEFAULT_FLAGS: FlagSet = { realtime: true, workspaceScouting: true, errorReporting: true, offlinePacks: true };

/** What each switch does, for the owner portal. `pending`: the feature it guards hasn't shipped yet, so
 *  the switch is stored but nothing reads it (said in the portal, never implied otherwise). */
export const FLAG_INFO: Record<Flag, { label: string; on: string; off: string; pending?: string }> = {
  realtime: {
    label: "Live updates stream",
    on: "Pages that follow an event get results pushed to them as they land.",
    off: "No stream connections are accepted; pages refresh on their own schedule instead.",
    pending: "The live stream hasn't shipped yet: this switch takes effect when it does.",
  },
  workspaceScouting: {
    label: "Workspace scouting",
    on: "Members of a Control Point workspace share scout entries.",
    off: "Shared entries pause; everyone's personal scouting keeps working.",
    pending: "Workspace scouting hasn't shipped yet: this switch takes effect when it does.",
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
};
