// @vitest-environment jsdom
// Which scout space opens: signed out → Personal only; with workspaces, the URL wins, then the
// space remembered on this device, then the first workspace; a workspace the account left is
// skipped (and reported); Control Point's answer unknown or the flag off → Personal only.
import { beforeEach, describe, expect, it } from "vitest";
import { lostNotice, readRememberedSpace, rememberSpace, resolveScoutSpace, scoutSpaceHref, SPACE_STORAGE_KEY, workspacesOf, type SpaceInput, type WorkspaceSpace } from "./scoutSpace";
import type { AccountUser } from "./personal";

const gear: WorkspaceSpace = { id: "901", name: "Gearheads", role: "admin" };
const bolt: WorkspaceSpace = { id: "902", name: "Bolt Bots", role: "member" };
const input = (over: Partial<SpaceInput> = {}): SpaceInput => ({ signedIn: true, enabled: true, workspaces: [gear, bolt], known: true, url: null, remembered: null, ...over });

beforeEach(() => localStorage.clear());

describe("resolveScoutSpace", () => {
  it("signed out: Personal only, no switcher, whatever the URL or this device says", () => {
    expect(resolveScoutSpace(input({ signedIn: false, workspaces: [], known: false, url: "901", remembered: { id: "901" } }))).toEqual({ space: null, switchable: false, lost: null });
  });

  it("signed in with no workspaces: Personal, and the switcher offers only Personal", () => {
    expect(resolveScoutSpace(input({ workspaces: [] }))).toEqual({ space: null, switchable: true, lost: null });
  });

  it("one workspace: it opens by default", () => {
    expect(resolveScoutSpace(input({ workspaces: [bolt] })).space).toBe("902");
  });

  it("two workspaces: the first opens by default", () => {
    expect(resolveScoutSpace(input())).toEqual({ space: "901", switchable: true, lost: null });
  });

  it("the remembered space opens, Personal included", () => {
    expect(resolveScoutSpace(input({ remembered: { id: "902" } })).space).toBe("902");
    expect(resolveScoutSpace(input({ remembered: { id: "personal" } })).space).toBeNull();
  });

  it("the URL wins over the remembered space", () => {
    expect(resolveScoutSpace(input({ url: "902", remembered: { id: "901" } })).space).toBe("902");
    expect(resolveScoutSpace(input({ url: "personal", remembered: { id: "902" } })).space).toBeNull();
  });

  it("a remembered workspace the account left falls back to the default, and is reported by name", () => {
    expect(resolveScoutSpace(input({ remembered: { id: "777", name: "Old Team" } }))).toEqual({ space: "901", switchable: true, lost: { id: "777", name: "Old Team" } });
  });

  it("a URL workspace that isn't the account's falls back to the remembered one, then the default", () => {
    expect(resolveScoutSpace(input({ url: "777", remembered: { id: "902" } }))).toEqual({ space: "902", switchable: true, lost: { id: "777", name: undefined } });
    expect(resolveScoutSpace(input({ url: "777" })).space).toBe("901");
    expect(resolveScoutSpace(input({ url: "not a valid id!" })).lost).toBeNull(); // junk is ignored, not reported
  });

  it("a space remembered for another account on this device is ignored (not used, not reported)", () => {
    expect(resolveScoutSpace(input({ account: 2, remembered: { id: "902", account: 1 } })).space).toBe("901");
    expect(resolveScoutSpace(input({ account: 2, remembered: { id: "777", name: "Old Team", account: 1 } })).lost).toBeNull();
    expect(resolveScoutSpace(input({ account: 1, remembered: { id: "902", account: 1 } })).space).toBe("902");
  });

  it("workspace scouting switched off: Personal only, no switcher", () => {
    expect(resolveScoutSpace(input({ enabled: false, url: "901" }))).toEqual({ space: null, switchable: false, lost: null });
  });

  it("Control Point's answer unknown (unreachable or an older server): Personal only, nothing reported lost", () => {
    expect(resolveScoutSpace(input({ workspaces: [], known: false, remembered: { id: "901", name: "Gearheads" } }))).toEqual({ space: null, switchable: false, lost: null });
  });
});

describe("workspacesOf", () => {
  const user = (cp: unknown) => ({ id: 1, email: null, displayName: null, createdAt: "", controlPoint: cp }) as AccountUser;
  it("reads the account's workspaces, dropping malformed and repeated ones", () => {
    const cp = { member: true, teams: [], url: "", workspaces: [gear, { id: "bad id", name: "x", role: "member" }, { ...gear, name: "dup" }, { id: "903", name: "", role: "owner" }] };
    expect(workspacesOf(user(cp))).toEqual({ known: true, list: [gear, { id: "903", name: "", role: "member" }] });
  });
  it("unknown when signed out, Control Point unreachable, or an older server", () => {
    expect(workspacesOf(null).known).toBe(false);
    expect(workspacesOf(user(null)).known).toBe(false);
    expect(workspacesOf(user({ member: true, teams: [], url: "" })).known).toBe(false);
  });
});

describe("the remembered space (this device only)", () => {
  it("round-trips through cs-scout-space, Personal as \"personal\"", () => {
    rememberSpace("901", "Gearheads");
    expect(JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)!)).toEqual({ id: "901", name: "Gearheads" });
    expect(readRememberedSpace()).toEqual({ id: "901", name: "Gearheads" });
    rememberSpace(null);
    expect(readRememberedSpace()).toEqual({ id: "personal" });
  });
  it("ignores junk", () => {
    localStorage.setItem(SPACE_STORAGE_KEY, "{not json");
    expect(readRememberedSpace()).toBeNull();
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify({ id: "../x" }));
    expect(readRememberedSpace()).toBeNull();
  });
});

it("links and notices", () => {
  expect(scoutSpaceHref(null)).toBe("/scout?space=personal");
  expect(scoutSpaceHref("901")).toBe("/scout?space=901");
  expect(lostNotice("Gearheads")).toMatch(/^You no longer have access to Gearheads\./);
  expect(lostNotice()).toMatch(/don't have access to that workspace/);
});
