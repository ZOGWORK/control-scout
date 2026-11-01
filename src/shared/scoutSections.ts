// The Scout page's sections, named for the job on event day: Event day (the picked event's match and pit
// queues), Entries (everything scouted, filtered) and Pick list & planning (the pick list, assignments,
// alliance, activity and the template). The page keeps the section in the URL (?tab=) and a view inside it
// (?view=). Links from before the rebuild (?tab=match, ?tab=matches, ?tab=data) map onto the new sections.
// Pure, so links built elsewhere (lite, inbox) and the page agree.

export const SCOUT_SECTIONS = ["event", "entries", "planning"] as const;
export type ScoutSection = (typeof SCOUT_SECTIONS)[number];
/** Personal's sections: nothing shared to plan (the pick list, assignments and alliance are a workspace's). */
export const PERSONAL_SECTIONS: readonly ScoutSection[] = ["event", "entries"];
export const SECTION_LABEL: Record<ScoutSection, string> = { event: "Event day", entries: "Entries", planning: "Pick list & planning" };

/** The views under Pick list & planning (Pick list first, the one it opens on). */
export const PLANNING_VIEWS = ["picklist", "assignments", "alliance", "activity", "template"] as const;
export type PlanningView = (typeof PLANNING_VIEWS)[number];
/** The views under Entries (the list, or this device's match recordings). */
export const ENTRY_VIEWS = ["entries", "recordings"] as const;
export type EntryView = (typeof ENTRY_VIEWS)[number];

export const isPlanningView = (v: string | null | undefined): v is PlanningView => PLANNING_VIEWS.includes(v as PlanningView);
export const isEntryView = (v: string | null | undefined): v is EntryView => ENTRY_VIEWS.includes(v as EntryView);

/** Old ?tab= values: Scout (match), its old match list (matches) and Data. */
const LEGACY_TABS = new Set(["match", "matches", "data"]);

/**
 * The section a URL asks for. A ?view= names its own section (views from before the rebuild included: a
 * planning view is under Pick list & planning, entries and recordings under Entries, pit under Event day).
 * Without one, a link to an entry opens Entries, a read-only workspace opens on Entries (it adds nothing), and
 * everything else on Event day.
 */
export function sectionFromUrl(sp: { get(k: string): string | null }, readOnly = false): ScoutSection {
  const view = sp.get("view");
  if (isPlanningView(view)) return "planning";
  if (isEntryView(view)) return "entries";
  if (view === "pit") return "event";
  const tab = sp.get("tab");
  // Any other view (a hand-edited or very old link) was one of Data's: Entries, where the old default was.
  if (view && !SCOUT_SECTIONS.includes(tab as ScoutSection)) return "entries";
  if (SCOUT_SECTIONS.includes(tab as ScoutSection)) return tab as ScoutSection;
  if (tab === "match" || tab === "matches") return "event";
  if (tab === "data") return "entries";
  // A link to one entry (a team page, an inbox item) opens it where entries live.
  if (sp.get("entry")) return "entries";
  return readOnly ? "entries" : "event";
}

/**
 * A URL from before the rebuild, rewritten for the new sections (null: nothing to change). ?tab=match and
 * ?tab=matches open Event day (a match named with ?at= still opens on it); ?tab=data opens the section its
 * view belongs to (Entries without one); ?view=pit opens Event day's pit queue; ?list=1 (the old match list
 * toggle) is dropped, since the queue is always on Event day.
 */
export function legacyScoutUrl(sp: URLSearchParams): URLSearchParams | null {
  const tab = sp.get("tab");
  const view = sp.get("view");
  const legacyTab = tab != null && LEGACY_TABS.has(tab);
  if (!legacyTab && !sp.has("list") && view !== "pit" && !sp.has("setup")) return null;
  const out = new URLSearchParams(sp);
  out.set("tab", sectionFromUrl(sp));
  out.delete("list");
  // The old setup screen (?setup=1) is the event picker now: Change event in the header.
  if (out.has("setup")) { out.delete("setup"); out.set("pick", "1"); }
  if (view === "pit") out.delete("view");
  return out;
}

/** A link to the shared pick list (lite's "Full version", the bundle page). */
export function picklistQuery(space: string | null, season: string | null): URLSearchParams {
  const q = new URLSearchParams();
  if (space) q.set("space", space);
  q.set("tab", "planning");
  q.set("view", "picklist");
  if (season) q.set("season", season);
  return q;
}
