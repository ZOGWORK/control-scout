// Where a save says it goes for an admin of several workspaces (server/scout/adminCopies.ts does the copying).
import { describe, expect, it } from "vitest";
import { savedToLine } from "./adminCopies";

const ws = [
  { id: "h", name: "Hypnotic Robotics", role: "admin" as const },
  { id: "f", name: "First Street Kids", role: "admin" as const },
  { id: "w", name: "Bad Wolf", role: "admin" as const },
  { id: "v", name: "Visitors", role: "member" as const },
];

describe("savedToLine", () => {
  it("names the workspace saved in first, then every other one the scout is an admin of", () => {
    expect(savedToLine(ws, "h")).toBe("Saving to Hypnotic Robotics, First Street Kids and Bad Wolf");
    expect(savedToLine(ws, "w")).toBe("Saving to Bad Wolf, Hypnotic Robotics and First Street Kids");
    expect(savedToLine(ws, "h", { online: false })).toBe("Goes to Hypnotic Robotics, First Street Kids and Bad Wolf when it syncs");
  });
  it("nothing for Personal, a member's workspace, a single admin workspace, a read-only one, or someone else's entry", () => {
    expect(savedToLine(ws, null)).toBeNull();
    expect(savedToLine(ws, "v")).toBeNull();
    expect(savedToLine(ws.slice(0, 1), "h")).toBeNull();
    expect(savedToLine([ws[0], { ...ws[1], orphaned: { reason: "deleted" } }], "h")).toBeNull();
    expect(savedToLine(ws, "h", { me: 7, author: 8 })).toBeNull();
    // A workspace whose scouting is paused gets nothing, so it isn't named.
    expect(savedToLine(ws, "h", { paused: (id) => id === "w" })).toBe("Saving to Hypnotic Robotics and First Street Kids");
    expect(savedToLine(ws, "h", { me: 7, author: 7 })).toBe("Saving to Hypnotic Robotics, First Street Kids and Bad Wolf");
  });
});
