// The inbox's shared rules: which activity makes an item, the per-kind switches in settings.notify
// (validated by cleanValue; a value saved before they existed stays byte for byte the same), and links.
import { describe, expect, it } from "vitest";
import { cleanValue, DEFAULT_SETTINGS } from "./personal";
import { INBOX_CATEGORIES, INBOX_TOGGLE, inboxCategory, inboxCategoryOn, inboxLink, inboxText } from "./inbox";

describe("settings.notify: the inbox switches", () => {
  it("an old value (no inbox keys) cleans to exactly itself: every kind on", () => {
    const old = { theme: "light", density: "compact", ambient: false, notify: { myTeamMatches: false, trackedTeams: true, upsets: true, eventStart: false } };
    expect(JSON.stringify(cleanValue("settings", old))).toBe(JSON.stringify(old));
    expect(JSON.stringify(cleanValue("settings", DEFAULT_SETTINGS))).toBe(JSON.stringify(DEFAULT_SETTINGS));
    for (const c of INBOX_CATEGORIES) expect(inboxCategoryOn(old.notify, c)).toBe(true);
  });

  it("keeps the inbox switches that are booleans; drops anything else", () => {
    const v = cleanValue("settings", { ...DEFAULT_SETTINGS, notify: { ...DEFAULT_SETTINGS.notify, inboxEdits: false, inboxTemplate: "no", inboxPicklist: true, somethingElse: false, __proto__x: true } })!;
    expect(v.notify).toEqual({ ...DEFAULT_SETTINGS.notify, inboxEdits: false, inboxPicklist: true });
    expect(inboxCategoryOn(v.notify, "edits")).toBe(false);
    expect(inboxCategoryOn(v.notify, "template")).toBe(true);
    expect(cleanValue("settings", { notify: "x" })!.notify).toEqual(DEFAULT_SETTINGS.notify);
  });

  it("one switch per kind", () => {
    expect(new Set(Object.values(INBOX_TOGGLE)).size).toBe(INBOX_CATEGORIES.length);
  });
});

describe("which activity becomes an item", () => {
  it.each([
    ["assignment.created", "assignments"], ["entry.edited", "edits"], ["entry.deleted", "edits"], ["photo.added", "edits"], ["photo.removed", "edits"],
    ["template.changed", "template"], ["settings.changed", "template"], ["member.joined", "membership"], ["member.left", "membership"],
    ["picklist.changed", "picklist"], ["comment.created", "comments"],
    ["entry.added", null], ["something.new", null],
  ])("%s → %s", (type, cat) => { expect(inboxCategory(type)).toBe(cat); });
});

describe("links", () => {
  it("open the entry, the activity, the template (admins), or the member's spaces", () => {
    expect(inboxLink("901", "entry.edited", { uuid: "u1", season: 2025 })).toBe("/scout?space=901&season=2025&entry=u1");
    expect(inboxLink("901", "entry.deleted", { uuid: "u1", season: 2025 })).toBe("/scout?space=901&view=activity");
    expect(inboxLink("901", "template.changed", { season: 2025 }, { admin: true })).toBe("/scout?space=901&season=2025&view=template");
    expect(inboxLink("901", "template.changed", { season: 2025 })).toBe("/scout?space=901&view=activity");
    expect(inboxLink("901", "settings.changed", {}, { admin: true })).toBe("/settings?section=workspace&workspace=901");
    expect(inboxLink("901", "member.joined", {})).toBe("/scout?space=901");
    expect(inboxLink("901", "member.left", {})).toBe("/scout?space=personal");
    // The pick list (Task 11) opens the shared pick list, in its season.
    expect(inboxLink("a b&c", "picklist.changed", {})).toBe("/scout?space=a+b%26c&view=picklist");
    expect(inboxLink("901", "picklist.moved", { season: 2025, team: 18360 })).toBe("/scout?space=901&season=2025&view=picklist");
    expect(inboxLink("901", "picklist.added", { season: 2025, team: 18360 }, { admin: true })).toBe("/scout?space=901&season=2025&view=picklist");
  });
});

describe("pick list words (Task 11)", () => {
  it("say who changed it, the season and what they did", () => {
    expect(inboxText("picklist.added", { season: 2025, team: 18360 }, "Coach", "Gearheads")).toEqual({ title: "Coach updated the pick list", body: "2025 season · added team 18360" });
    expect(inboxText("picklist.added", { season: 2025, teams: [1, 2], count: 2 }, "Coach", "Gearheads").body).toBe("2025 season · added 2 teams");
    expect(inboxText("picklist.moved", { season: 2025, team: 7, to: 1, teams: [7, 8] }, "Coach", "").body).toBe("2025 season · moved 2 teams");
    expect(inboxText("picklist.removed", { season: 2025, team: 7 }, "", "").title).toBe("Someone updated the pick list");
    expect(inboxText("picklist.changed", { season: 2025 }, "Coach", "").body).toBe("2025 season");
  });
});
