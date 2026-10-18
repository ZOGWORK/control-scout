// My teams: the account's FTC teams, from Control Point's teams (FTC numbers) paired with its workspaces (roles).
import { describe, expect, it } from "vitest";
import type { AccountUser } from "./personal";
import { myTeamsOf } from "./myTeams";

type W = { id: string; name: string; role: "admin" | "member"; orphaned?: { at: string; reason: "deleted" | "no_admin" } };
const ws = (id: string, name: string, role: "admin" | "member" = "member", orphaned?: W["orphaned"]): W => ({ id, name, role, ...(orphaned ? { orphaned } : {}) });
const user = (workspaces: W[] | undefined, teams: { teamNumber: number | null; name: string }[]): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9, member: true, teams, url: "https://cp.test", ...(workspaces ? { workspaces } : {}) },
});

describe("myTeamsOf", () => {
  it("signed out or Control Point unknown: nothing, and not known", () => {
    expect(myTeamsOf(null)).toEqual({ teams: [], unnumbered: [], known: false });
    expect(myTeamsOf(user(undefined, [{ teamNumber: 1, name: "A" }]))).toMatchObject({ teams: [], known: false });
  });

  it("pairs each workspace with its FTC number, admin teams first, then Control Point's order", () => {
    const r = myTeamsOf(user([ws("1", "Bolt Bots"), ws("2", "Hypnotic Robotics", "admin"), ws("3", "Gearheads", "admin")],
      [{ teamNumber: 9999, name: "Bolt Bots" }, { teamNumber: 18360, name: "Hypnotic Robotics" }, { teamNumber: 4215, name: "Gearheads" }]));
    expect(r.known).toBe(true);
    expect(r.teams.map((t) => [t.teamNumber, t.workspaces.map((w) => `${w.id}:${w.role}`)])).toEqual([[18360, ["2:admin"]], [4215, ["3:admin"]], [9999, ["1:member"]]]);
    expect(r.unnumbered).toEqual([]);
  });

  it("a workspace with no FTC number is listed as unnumbered, never dropped", () => {
    const r = myTeamsOf(user([ws("1", "Rookies", "admin"), ws("2", "Gearheads")], [{ teamNumber: null, name: "Rookies" }, { teamNumber: 4215, name: "Gearheads" }]));
    expect(r.teams.map((t) => t.teamNumber)).toEqual([4215]);
    expect(r.unnumbered.map((w) => w.id)).toEqual(["1"]);
  });

  it("a workspace deleted in Control Point (kept read-only by Scout) neither shows nor shifts the pairing", () => {
    const r = myTeamsOf(user([ws("1", "Old", "admin", { at: "2026-01-01", reason: "deleted" }), ws("2", "Gearheads")], [{ teamNumber: 4215, name: "Gearheads" }]));
    expect(r.teams).toEqual([{ teamNumber: 4215, workspaces: [ws("2", "Gearheads")] }]);
    expect(r.unnumbered).toEqual([]);
  });

  it("pairs by name in order: a workspace past Control Point's 10-team cap has no number rather than a wrong one", () => {
    const names = Array.from({ length: 11 }, (_, i) => `T${i}`);
    const r = myTeamsOf(user(names.map((n, i) => ws(String(i), n)), names.slice(0, 10).map((n, i) => ({ teamNumber: 100 + i, name: n }))));
    expect(r.teams).toHaveLength(10);
    expect(r.teams[9]).toMatchObject({ teamNumber: 109 });
    expect(r.unnumbered.map((w) => w.name)).toEqual(["T10"]);
  });

  it("a name over 120 characters (cut short in the workspace list, whole in the team list) still pairs", () => {
    const long = `${"Long ".repeat(30)}Robotics`;
    const r = myTeamsOf(user([ws("1", long.slice(0, 120).trim())], [{ teamNumber: 4215, name: long }]));
    expect(r.teams.map((t) => t.teamNumber)).toEqual([4215]);
    expect(r.unnumbered).toEqual([]);
  });

  it("two workspaces for one FTC team: one card, both workspaces", () => {
    const r = myTeamsOf(user([ws("1", "Gearheads"), ws("2", "Gearheads B", "admin")], [{ teamNumber: 4215, name: "Gearheads" }, { teamNumber: 4215, name: "Gearheads B" }]));
    expect(r.teams).toEqual([{ teamNumber: 4215, workspaces: [ws("1", "Gearheads"), ws("2", "Gearheads B", "admin")] }]);
  });
});
