// @vitest-environment jsdom
// The entry forms' pieces: what the Save bar says (never a sync that hasn't happened), the team picker (by number
// or name, confirmed by name), the match form's tap strip, and the two field types the rebuild added.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { saveState, SaveState } from "./SaveState";
import { matchTeams, TeamPicker } from "./TeamPicker";
import { ScoreStrip, tapTotal } from "./ScoreStrip";
import { BigFieldInput, numberLabel, parseNumberAnswer } from "../redesign/BigFieldInput";
import { cleanField, detailKey, type ScoutField, type ScoutTemplate } from "../../../shared/scoutTemplate";
import { builtinTemplate } from "../../../shared/scoutDefaults";

afterEach(cleanup);

describe("saveState", () => {
  it("says only what's true: on this device, saving, queued offline, failed, saved", () => {
    expect(saveState({ status: "local", pending: 0 }, false).kind).toBe("unsaved");
    expect(saveState({ status: "local", pending: 2 }, true).text).toBe("Saved on this device");
    expect(saveState({ status: "syncing", pending: 3 }, true).text).toBe("Saving… 3 to sync");
    expect(saveState({ status: "idle", pending: 1 }, true).text).toBe("Saving… 1 to sync");
    expect(saveState({ status: "offline", pending: 4 }, true).text).toBe("Queued offline · 4 to sync");
    expect(saveState({ status: "error", pending: 2 }, true).text).toBe("Sync failed · 2 to sync");
    expect(saveState({ status: "idle", pending: 0 }, true)).toEqual({ kind: "saved", text: "Saved" });
    // Nothing saved yet this visit: how saving works, not "Saved".
    expect(saveState({ status: "idle", pending: 0 }, false).kind).toBe("unsaved");
  });

  it("a failed sync offers Retry", () => {
    const onRetry = vi.fn();
    render(<SaveState sync={{ status: "error", pending: 1, onRetry }} savedHere />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("TeamPicker", () => {
  const teams = [{ team: 102, name: "Bad Wolf" }, { team: 1020, name: "Gearheads" }, { team: 7777, name: "Wolfpack" }];

  it("matches by number prefix and by name word", () => {
    expect(matchTeams(teams, "102").map((t) => t.team)).toEqual([102, 1020]);
    expect(matchTeams(teams, "wolf").map((t) => t.team)).toEqual([102, 7777]);
    expect(matchTeams(teams, "").length).toBe(3);
  });

  it("picks from the list and confirms the team by name; Change goes back to the box", () => {
    let value = "";
    const onChange = (v: string) => { value = v; };
    const { rerender } = render(<TeamPicker teams={teams} value={value} onChange={onChange} />);
    const box = screen.getByRole("combobox", { name: "Team" });
    fireEvent.change(box, { target: { value: "gear" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: /1020/ }));
    expect(value).toBe("1020");
    rerender(<TeamPicker teams={teams} value={value} onChange={onChange} />);
    expect(screen.getByRole("group", { name: "Team: 1020 Gearheads" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Change team/ }));
    expect(value).toBe("");
  });

  it("a team off the list can still be used by its number", () => {
    let value = "";
    render(<TeamPicker teams={teams} value="" onChange={(v) => { value = v; }} />);
    const box = screen.getByRole("combobox", { name: "Team" });
    fireEvent.change(box, { target: { value: "31337" } });
    expect(screen.getByRole("option", { name: /Use team 31337/ })).toBeTruthy();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(value).toBe("31337");
  });

  it("shows its error inline", () => {
    render(<TeamPicker teams={teams} value="" onChange={() => {}} error="Pick the team first." />);
    expect(screen.getByText("Pick the team first.")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Team" }).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("ScoreStrip", () => {
  const template: ScoutTemplate = { id: "t", version: 0, kind: "match", fields: [
    { id: "a", label: "Cones", type: "counter", phase: "teleop", max: 30 },
    { id: "b", label: "Laps", type: "counter", phase: "teleop", min: 2, max: 9 },
    { id: "c", label: "Parked", type: "toggle", phase: "endgame" },
  ] } as ScoutTemplate;

  it("a robot's taps are its counters added up (an untouched counter at its floor); toggles don't count", () => {
    expect(tapTotal({ template, data: {} })).toBe(2);
    expect(tapTotal({ template, data: { a: 5, b: 3, c: true } })).toBe(8);
  });

  it("each alliance's total, for the robots being scouted", () => {
    render(<ScoreStrip robots={[
      { team: 1, side: "red", station: 1, data: { a: 4 }, template },
      { team: 2, side: "red", station: 2, data: { a: 1 }, template },
      { team: 3, side: "blue", station: 1, data: {}, template },
    ]} />);
    expect(screen.getByLabelText("red alliance 9 taps")).toBeTruthy();
    // One blue robot: its own number is the total, no separate alliance figure.
    expect(screen.queryByLabelText(/blue alliance/)).toBeNull();
  });
});

describe("Number + unit and Yes / no + detail fields", () => {
  it("cleanField keeps a number's unit and range, and a yes/no's detail question", () => {
    expect(cleanField({ id: "w", label: "Robot weight (lb)", type: "number", phase: "pit", unit: " lb ", max: 200 }, "pit"))
      .toEqual({ field: { id: "w", label: "Robot weight (lb)", type: "number", phase: "pit", unit: "lb", max: 200 } });
    expect(cleanField({ id: "e", label: "Endgame", type: "toggleDetail", phase: "pit", detail: "What, and how reliably?" }, "pit"))
      .toEqual({ field: { id: "e", label: "Endgame", type: "toggleDetail", phase: "pit", detail: "What, and how reliably?" } });
    expect(detailKey("e")).toBe("e__detail");
  });

  it("a typed number is clamped to its range, empty while blank", () => {
    const f = { min: 0, max: 200 };
    expect(parseNumberAnswer("", f)).toBeUndefined();
    expect(parseNumberAnswer("12,5", f)).toBe(12.5);
    expect(parseNumberAnswer("999", f)).toBe(200);
    expect(parseNumberAnswer("abc", f)).toBeUndefined();
    expect(numberLabel({ label: "Robot weight (lb)", unit: "lb" })).toBe("Robot weight");
  });

  it("yes reveals the detail box; no hides it", () => {
    const f: ScoutField = { id: "e", label: "Can do the endgame", type: "toggleDetail", phase: "pit", detail: "What, and how reliably?" };
    const onChange = vi.fn(), onDetail = vi.fn();
    const { rerender } = render(<BigFieldInput f={f} value={undefined} onChange={onChange} detail="" onDetail={onDetail} />);
    expect(screen.queryByPlaceholderText("What, and how reliably?")).toBeNull();
    rerender(<BigFieldInput f={f} value={true} onChange={onChange} detail="" onDetail={onDetail} />);
    fireEvent.change(screen.getByLabelText(/What, and how reliably\?/), { target: { value: "Hangs, 9 of 10" } });
    expect(onDetail).toHaveBeenCalledWith("Hangs, 9 of 10");
  });

  it("the built-in pit template uses them, with ids and labels as before", () => {
    const pit = builtinTemplate(2025, "pit").fields;
    expect(pit.find((f) => f.id === "weight")).toMatchObject({ type: "number", unit: "lb" });
    expect(pit.find((f) => f.id === "endgameCapable")).toMatchObject({ type: "toggleDetail", label: "Can do the endgame" });
    expect(pit.find((f) => f.id === "canDefend")).toMatchObject({ type: "toggleDetail", label: "Willing to play defense" });
  });
});
