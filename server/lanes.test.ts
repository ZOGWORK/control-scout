// A lane knows it's a hand-off (server/lanes.ts) only from the lane template's CS_LANE and CS_LANE_UNIT and the other
// lane being active; anything else (no lanes, a lone lane, systemd unreachable) is a cold start.
import { describe, expect, it } from "vitest";
import { handingOver } from "./lanes";

const asked: string[] = [];
const activeOnly = (...on: string[]) => async (u: string) => { asked.push(u); return on.includes(u); };

describe("handingOver", () => {
  it("is a hand-off when the other lane serves", async () => {
    asked.length = 0;
    expect(await handingOver({ CS_LANE: "b", CS_LANE_UNIT: "control-scout" }, activeOnly("control-scout@a.service"))).toBe(true);
    expect(await handingOver({ CS_LANE: "a", CS_LANE_UNIT: "control-scout" }, activeOnly("control-scout@b.service"))).toBe(true);
    expect(asked).toEqual(["control-scout@a.service", "control-scout@b.service"]);
  });

  it("is a cold start when the other lane isn't serving, or it can't tell", async () => {
    expect(await handingOver({ CS_LANE: "a", CS_LANE_UNIT: "control-scout" }, activeOnly())).toBe(false);
    expect(await handingOver({ CS_LANE: "a", CS_LANE_UNIT: "control-scout" }, async () => { throw new Error("no systemd"); })).toBe(false);
  });

  it("is never a hand-off outside the lanes", async () => {
    const on = activeOnly("control-scout@a.service", "control-scout@b.service");
    expect(await handingOver({}, on)).toBe(false);
    expect(await handingOver({ CS_LANE: "c", CS_LANE_UNIT: "control-scout" }, on)).toBe(false);
    expect(await handingOver({ CS_LANE: "a" }, on)).toBe(false);
    expect(await handingOver({ CS_LANE: "a", CS_LANE_UNIT: "x; rm -rf /" }, on)).toBe(false);
  });
});
