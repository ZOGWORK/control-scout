// @vitest-environment jsdom
// The one-phase-at-a-time form: tabs only for phases with fields (After always, with the notes),
// arrow keys between tabs, undo of the last tap, and the match timer moving the tab with the match.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinTemplate } from "../../../shared/scoutDefaults";
import type { FieldPhase, ScoutTemplate } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";
import { breakdownTone, formPhases, PhaseForm, shownPhase } from "./PhaseForm";
import { useMatchTimer } from "./useMatchTimer";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const T26 = builtinTemplate(2026, "match");
let values: Record<string, ScoutValue> = {};
function Harness({ template = T26, start = "auto" as FieldPhase }: { template?: ScoutTemplate; start?: FieldPhase }) {
  const [v, setV] = useState<Record<string, ScoutValue>>({});
  const [notes, setNotes] = useState("");
  const [phase, setPhase] = useState<FieldPhase>(start);
  values = v;
  return <PhaseForm template={template} value={v} onChange={setV} notes={notes} onNotes={setNotes} notesLabel="Notes on 12345" phase={phase} onPhase={setPhase} />;
}
// Radix tabs pick on mouse down (a click is down + up), as the pointer does.
const pickTab = (name: string | RegExp) => fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
const selected = () => screen.getByRole("tab", { selected: true }).textContent;

describe("phases", () => {
  it("the 2026 template has all four, After last", () => {
    expect(formPhases(T26)).toEqual(["auto", "teleop", "endgame", "overall"]);
    render(<Harness />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Auto", "TeleOp", "Endgame", "After"]);
  });
  it("leaves out a phase with no fields but always keeps After for the notes", () => {
    const t: ScoutTemplate = { id: "x", kind: "match", name: "x", fields: [{ id: "a", label: "A", type: "toggle", phase: "auto" }] };
    expect(formPhases(t)).toEqual(["auto", "overall"]);
    expect(formPhases(builtinTemplate(2026, "pit"))).toEqual(["pit"]);
  });
  it("shows only the chosen phase's fields; After has the overall fields and the notes", () => {
    render(<Harness />);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(screen.getByRole("tab", { name: "Auto" }).id);
    expect(screen.getByRole("button", { name: "Left start zone" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Pollen/ })).toBeNull();
    expect(screen.queryByLabelText("Notes on 12345")).toBeNull();
    pickTab("After");
    expect(screen.getByRole("radiogroup", { name: "Driver skill" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Broke down / disabled" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Notes on 12345"), { target: { value: "fast cycles" } });
    expect((screen.getByLabelText("Notes on 12345") as HTMLTextAreaElement).value).toBe("fast cycles");
  });
  it("arrow keys, Home and End move between tabs", async () => {
    render(<Harness />);
    // Radix moves the focus on the next tick, and a focused tab is the picked one.
    const key = async (from: string, k: string) => {
      fireEvent.keyDown(screen.getByRole("tab", { name: from }), { key: k });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    };
    act(() => screen.getByRole("tab", { name: "Auto" }).focus());
    await key("Auto", "ArrowRight");
    expect(selected()).toBe("TeleOp");
    expect(document.activeElement?.textContent).toBe("TeleOp");
    await key("TeleOp", "End");
    expect(selected()).toBe("After");
    await key("After", "ArrowRight");
    expect(selected()).toBe("Auto");
    await key("Auto", "ArrowLeft");
    expect(selected()).toBe("After");
  });
  it("a phase the template doesn't have shows the nearest one before it, else the first", () => {
    expect(shownPhase(["auto", "teleop", "overall"], "endgame")).toBe("teleop");
    expect(shownPhase(["teleop", "overall"], "auto")).toBe("teleop");
    const t: ScoutTemplate = { id: "x", kind: "match", name: "x", fields: [{ id: "a", label: "A", type: "toggle", phase: "teleop" }] };
    render(<Harness template={t} start="endgame" />);
    expect(selected()).toBe("TeleOp");
  });
});

describe("undo last tap", () => {
  it("puts back the value before the last tap, once", () => {
    render(<Harness start="teleop" />);
    const undo = screen.getByRole("button", { name: "Undo last tap" });
    expect(undo).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: /Pollen \/ nectar scored: 0/ }));
    fireEvent.click(screen.getByRole("button", { name: /Pollen \/ nectar scored: 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Played defense" }));
    expect(values).toEqual({ pollen: 2, defense: true });
    fireEvent.click(undo);
    expect(values).toEqual({ pollen: 2 });
    expect(undo).toHaveProperty("disabled", true);
  });
  it("a first tap undone leaves the field unanswered", () => {
    render(<Harness start="endgame" />);
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    expect(values).toEqual({ park: "Full" });
    fireEvent.click(screen.getByRole("button", { name: "Undo last tap" }));
    expect(values).toEqual({});
  });
  it("never undoes into another team's answers, even where both hold the same value", () => {
    const t = T26;
    function Swap() {
      const [team, setTeam] = useState(0);
      const [v, setV] = useState<Record<string, ScoutValue>[]>([{}, { defense: true }]);
      values = v[team];
      return (
        <>
          <button onClick={() => setTeam(1)}>other team</button>
          <PhaseForm template={t} value={v[team]} onChange={(n) => setV((all) => all.map((x, i) => (i === team ? n : x)))} notes="" onNotes={() => {}} phase="teleop" onPhase={() => {}} />
        </>
      );
    }
    render(<Swap />);
    fireEvent.click(screen.getByRole("button", { name: "Played defense" }));
    fireEvent.click(screen.getByText("other team"));
    expect(screen.getByRole("button", { name: "Undo last tap" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Undo last tap" }));
    expect(values).toEqual({ defense: true });
  });
});

describe("match timer", () => {
  it("is off by default and shown on Auto only until started", () => {
    render(<Harness />);
    expect(screen.getByRole("timer").textContent).toBe("Off");
    pickTab("TeleOp");
    expect(screen.queryByRole("timer")).toBeNull();
  });
  it("waits on the first tab when the template has no auto fields", () => {
    vi.useFakeTimers();
    const t: ScoutTemplate = { id: "x", kind: "match", name: "x", fields: [{ id: "a", label: "A", type: "counter", phase: "teleop" }] };
    render(<Harness template={t} start="teleop" />);
    fireEvent.click(screen.getByRole("button", { name: "Match started" }));
    expect(selected()).toContain("TeleOp");
    act(() => { vi.advanceTimersByTime(130_000); });
    // No endgame fields: the endgame keeps the nearest earlier tab.
    expect(selected()).toContain("TeleOp");
    expect(screen.getByRole("timer").textContent).toBe("Endgame 0:28");
  });
  it("shows the field's clock and moves the tab at each boundary; a tab picked by hand holds until the next", () => {
    vi.useFakeTimers();
    render(<Harness start="teleop" />);
    pickTab("Auto");
    fireEvent.click(screen.getByRole("button", { name: "Match started" }));
    act(() => { vi.advanceTimersByTime(12_000); });
    expect(screen.getByRole("timer").textContent).toBe("Auto 0:18");
    expect(screen.getByRole("tab", { name: /Auto/ }).textContent).toContain("(now)");
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.getByRole("timer").textContent).toBe("Transition 0:06");
    expect(selected()).toContain("Auto");
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(selected()).toContain("TeleOp");
    expect(screen.getByText("TeleOp now")).toBeTruthy();
    pickTab(/^Auto/);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(selected()).toBe("Auto");
    expect(screen.queryByText("TeleOp now")).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(selected()).toContain("Endgame");
    expect(screen.getByRole("timer").textContent).toBe("Endgame 0:30");
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByRole("timer").textContent).toBe("Ended");
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    pickTab("Auto");
    expect(screen.getByRole("timer").textContent).toBe("Off");
  });
  it("a timer kept by the caller survives switching teams (the form remounting)", () => {
    vi.useFakeTimers();
    function Page() {
      const [phase, setPhase] = useState<FieldPhase>("auto");
      const [team, setTeam] = useState(0);
      const timer = useMatchTimer(setPhase);
      return (
        <>
          <button onClick={() => setTeam((n) => 1 - n)}>switch team</button>
          <PhaseForm key={team} template={T26} value={{}} onChange={() => {}} notes="" onNotes={() => {}} phase={phase} onPhase={setPhase} timer={timer} />
        </>
      );
    }
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Match started" }));
    act(() => { vi.advanceTimersByTime(40_000); });
    fireEvent.click(screen.getByText("switch team"));
    expect(selected()).toContain("TeleOp");
    expect(screen.getByRole("timer").textContent).toBe("TeleOp 1:58");
  });
});

it("a breakdown yes/no gets the bad tone", () => {
  expect(breakdownTone({ id: "broke", label: "Broke down / disabled", type: "toggle", phase: "overall" })).toBe("bad");
  expect(breakdownTone({ id: "defense", label: "Played defense", type: "toggle", phase: "teleop" })).toBe("default");
});
