// The notification inbox (docs/inbox.md), shared by the server and the web app: the kinds of item,
// the per-kind switches in Settings › Notifications, and the words an item says.
//
// An item is about one thing that happened in a workspace (or, for owners, an owner alert), written
// for one account. The server writes the title, body and link when it creates the item, so every
// device shows the same words and a tap opens the same place.

/** What an item is about: one switch each in Settings › Notifications. */
export const INBOX_CATEGORIES = ["assignments", "edits", "template", "membership", "picklist", "comments", "ownerAlerts"] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

/** The settings key (in settings.notify) that switches a category off when false. Missing means on. */
export const INBOX_TOGGLE = {
  assignments: "inboxAssignments",
  edits: "inboxEdits",
  template: "inboxTemplate",
  membership: "inboxMembership",
  picklist: "inboxPicklist",
  comments: "inboxComments",
  ownerAlerts: "inboxOwnerAlerts",
} as const satisfies Record<InboxCategory, string>;
export type InboxToggleKey = (typeof INBOX_TOGGLE)[InboxCategory];
export const INBOX_TOGGLE_KEYS = Object.values(INBOX_TOGGLE) as InboxToggleKey[];

/** Is this category on in these notify settings? (Missing or anything but false: on.) */
export const inboxCategoryOn = (notify: Partial<Record<string, unknown>> | null | undefined, c: InboxCategory): boolean => notify?.[INBOX_TOGGLE[c]] !== false;

/** Settings › Notifications: label and explanation per switch. Owner alerts show to owners only. */
export const INBOX_CATEGORY_INFO: Record<InboxCategory, { label: string; hint: string; ownerOnly?: true }> = {
  assignments: { label: "Assignments", hint: "Someone assigns you a team to scout" },
  edits: { label: "Changes to my entries", hint: "Someone else edits or deletes an entry you made, or adds or removes a photo on it" },
  template: { label: "Template and workspace settings", hint: "An admin changes a workspace's scouting fields or its defaults for new entries" },
  membership: { label: "Workspace membership", hint: "You're added to a workspace or removed from one" },
  picklist: { label: "Pick list", hint: "Someone updates a workspace's pick list" },
  comments: { label: "Comments", hint: "Someone comments on an entry you made" },
  ownerAlerts: { label: "Owner alerts", hint: "Things to act on for this server, such as photo storage running low", ownerOnly: true },
};

/** One item as GET /api/inbox lists it. */
export interface InboxItem {
  id: number;
  /** ms */
  at: number;
  /** Control Point's workspace id; null for owner alerts. */
  workspaceId: string | null;
  workspaceName: string;
  category: InboxCategory;
  /** The activity type it came from (entry.edited, assignment.created, …) or "owner.alert". */
  type: string;
  actorName: string;
  title: string;
  body: string;
  /** A path in the app to open on tap. */
  link: string;
  read: boolean;
}

export interface InboxPage { items: InboxItem[]; more: boolean; unread: number }

export const INBOX_PAGE = 30, INBOX_PAGE_MAX = 100;
/** Items older than this are deleted (the scheduler). */
export const INBOX_RETENTION_MS = 90 * 24 * 3600_000;

// --- Which activity becomes an item ------------------------------------------------------

/**
 * The category of an activity type, or null when it never makes an item. Who gets it is decided
 * on the server (server/inbox/inbox.ts): the entry's author, the assignee, the member, or every member.
 */
export function inboxCategory(type: string): InboxCategory | null {
  if (type.startsWith("assignment.")) return "assignments";
  if (type === "entry.edited" || type === "entry.deleted" || type === "entry.restored" || type === "entry.version_restored" || type === "photo.added" || type === "photo.removed") return "edits";
  // Workspace settings (Task 6: the defaults for new entries) are an admin's change to how everyone scouts, like the template.
  if (type === "template.changed" || type === "settings.changed") return "template";
  if (type === "member.joined" || type === "member.left") return "membership";
  if (type.startsWith("picklist.")) return "picklist";
  if (type === "comment.created" || type === "comment.added") return "comments";
  return null;
}

// --- Words --------------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "team 1234", "teams 1234 and 5678", "teams 1234, 5678 and 3 more": an assignment's teams (details.teams when it covers several). */
export function assignedTeams(d: Record<string, unknown>): string {
  const teams = Array.isArray(d.teams) ? d.teams.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
  if (teams.length > 1) {
    if (teams.length === 2) return `teams ${teams[0]} and ${teams[1]}`;
    if (teams.length === 3) return `teams ${teams[0]}, ${teams[1]} and ${teams[2]}`;
    return `teams ${teams[0]}, ${teams[1]} and ${teams.length - 2} more`;
  }
  const team = num(d.team);
  return team ? `team ${team}` : "a team";
}

/** "team 18360 · match Q12 · USNJQ1" / "team 18360 · pit" for an entry. */
export function entrySubject(d: Record<string, unknown>): string {
  const team = num(d.team);
  const where = d.kind === "pit" ? "pit" : str(d.matchLabel) ? `match ${str(d.matchLabel)}` : "match";
  return [team ? `team ${team}` : "an entry", where, str(d.eventCode)].filter(Boolean).join(" · ");
}

const scoutHref = (workspaceId: string, params: Record<string, string | number | null | undefined>) => {
  const q = new URLSearchParams({ space: workspaceId });
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, String(v));
  return `/scout?${q.toString()}`;
};

/** Where tapping an item about a workspace goes. `admin`: the recipient's role (only admins can open the template editor). */
export function inboxLink(workspaceId: string, type: string, d: Record<string, unknown>, opts: { admin?: boolean } = {}): string {
  const uuid = str(d.uuid) ?? str(d.entryUuid);
  const season = num(d.season);
  switch (inboxCategory(type)) {
    case "edits":
    case "comments":
      // A deleted entry can't be opened: its line in the activity view says what happened.
      return uuid && type !== "entry.deleted" ? scoutHref(workspaceId, { season, entry: uuid }) : scoutHref(workspaceId, { view: "activity" });
    case "template":
      if (!opts.admin) return scoutHref(workspaceId, { view: "activity" });
      return type === "settings.changed" ? `/settings?${new URLSearchParams({ section: "workspace", workspace: workspaceId }).toString()}` : scoutHref(workspaceId, { season, view: "template" });
    case "membership":
      return type === "member.left" ? "/scout?space=personal" : scoutHref(workspaceId, {});
    case "assignments":
      // The Assignments view (Task 10): My assignments, with progress and Done. A removed one is only in the feed.
      return type === "assignment.deleted" ? scoutHref(workspaceId, { view: "activity" }) : scoutHref(workspaceId, { season, view: "assignments" });
    default:
      return scoutHref(workspaceId, { view: "activity" });
  }
}

/** Title and body of an item about workspace activity, as its recipient reads it. */
export function inboxText(type: string, d: Record<string, unknown>, actorName: string, workspaceName: string): { title: string; body: string } {
  const who = actorName.trim() || "Someone";
  const ws = workspaceName.trim() || "your workspace";
  switch (type) {
    case "entry.edited": {
      const edits = num(d.edits);
      return { title: `${who} edited your entry`, body: `${entrySubject(d)}${edits && edits > 1 ? ` · ${edits} edits` : ""}` };
    }
    case "entry.deleted": return { title: `${who} deleted your entry`, body: entrySubject(d) };
    case "entry.restored": return { title: `${who} restored your entry`, body: entrySubject(d) };
    case "entry.version_restored": return { title: `${who} restored an earlier version of your entry`, body: [entrySubject(d), num(d.fromVersion) ? `version ${num(d.fromVersion)}` : null].filter(Boolean).join(" · ") };
    case "photo.added": return { title: `${who} added a photo to your entry`, body: entrySubject(d) };
    case "photo.removed": return { title: `${who} removed a photo from your entry`, body: entrySubject(d) };
    case "template.changed": {
      const kinds = Array.isArray(d.kinds) ? d.kinds.map(String) : [];
      const which = kinds.length === 1 ? `${kinds[0]} fields` : "fields";
      return { title: `${who} changed the scouting template`, body: [`${num(d.season) ?? ""} ${which}`.trim(), num(d.version) ? `version ${num(d.version)}` : null].filter(Boolean).join(" · ") };
    }
    case "settings.changed": {
      const def = d.defaults && typeof d.defaults === "object" ? d.defaults as Record<string, unknown> : {};
      const parts = [num(def.season) ? `season ${num(def.season)}` : "current season", str(def.eventCode) ? `event ${str(def.eventCode)}` : "no event"];
      return { title: `${who} changed the defaults for new entries`, body: parts.join(", ") };
    }
    case "member.joined": return { title: `You were added to ${ws}`, body: d.role === "admin" ? "As an admin. Its scout space is now on your Scout page." : "Its scout space is now on your Scout page." };
    case "member.left": return { title: `You were removed from ${ws}`, body: "Your personal entries are unchanged." };
    case "comment.created":
    case "comment.added": {
      const excerpt = str(d.excerpt) ?? str(d.text);
      return { title: `${who} commented on your entry`, body: [entrySubject(d), excerpt ? `“${excerpt.slice(0, 120)}”` : null].filter(Boolean).join(" · ") };
    }
  }
  if (type.startsWith("assignment.")) {
    const what = assignedTeams(d);
    const where = [str(d.matchLabel) ? `match ${str(d.matchLabel)}` : d.kind === "pit" ? "pit" : null, str(d.eventCode)].filter(Boolean).join(" · ");
    // Task 10: done / reopened / deleted reach the assignee only when someone else (an admin) did it.
    const about = [what, where].filter(Boolean).join(" · ");
    if (type === "assignment.completed") return { title: `${who} marked your assignment done`, body: about };
    if (type === "assignment.reopened") return { title: `${who} reopened your assignment`, body: about };
    if (type === "assignment.deleted") return { title: `${who} removed your assignment`, body: about };
    return { title: `${who} assigned you to scout ${what}`, body: where };
  }
  if (type.startsWith("picklist.")) return { title: `${who} updated the pick list`, body: num(d.season) ? `${num(d.season)} season` : "" };
  return { title: `${who}: ${type.replace(/[._]/g, " ")}`, body: "" };
}
