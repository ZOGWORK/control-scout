// @vitest-environment jsdom
// Quick mode picks its fields from the template (the main TeleOp counter, the endgame choice, and up to three
// yes/no taps), and every tap hands the team's whole answers record back, so it lands in the same draft as the
// full form.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { builtinTemplate } from "../../../shared/scoutDefaults";
import type { ScoutTemplate } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";
import type { TeamState } from "../../../lib/matchDraft";
import { QuickMatchForm, quickFields } from "./QuickMatchForm";

afterEach(cleanup);

const ids = (t: ScoutTemplate) => {
  const q = quickFields(t);
  return { counter: q.counter?.id ?? null, choice: q.choice?.id ?? null, toggles: q.toggles.map((x) => `${x.kind}:${x.field.id}`) };
};

describe("quickFields", () => {
  it("2026: pollen, end park, leave/defense/broke", () => {
    expect(ids(builtinTemplate(2026, "match"))).toEqual({ counter: "pollen", choice: "park", toggles: ["leave:autoLeave", "defense:defense", "broke:broke"] });
  });
  it("2025: TeleOp artifacts, return to base, leave/defense/broke", () => {
    expect(ids(builtinTemplate(2025, "match"))).toEqual({ counter: "artifacts", choice: "base", toggles: ["leave:autoLeave", "defense:defense", "broke:broke"] });
  });
  it("2024: a tie on max goes to the first counter; no leave field", () => {
    expect(ids(builtinTemplate(2024, "match"))).toEqual({ counter: "samples", choice: "ascent", toggles: ["defense:defense", "broke:broke"] });
  });
  it("2023: no endgame choice (its endgame is yes/no), no auto leave", () => {
    expect(ids(builtinTemplate(2023, "match"))).toEqual({ counter: "pixels", choice: null, toggles: ["defense:defense", "broke:broke"] });
  });
  it("a custom workspace template: by label and phase, not id", () => {
    const t: ScoutTemplate = { id: "ws:abc:2026:match", kind: "match", name: "Ours", version: 3, fields: [
      { id: "mob", label: "Mobility", type: "toggle", phase: "auto" },
      { id: "x1", label: "Low goal", type: "counter", phase: "teleop", max: 30 },
      { id: "x2", label: "High goal", type: "counter", phase: "teleop", max: 50 },
      { id: "x3", label: "Auto points", type: "counter", phase: "auto", max: 90 },
      { id: "climb", label: "Climb", type: "choice", phase: "endgame", options: ["Low", "High"] },
      { id: "d", label: "Defended a lot", type: "toggle", phase: "teleop" },
      { id: "dc", label: "Robot died", type: "toggle", phase: "overall" },
      { id: "dc2", label: "Disabled again", type: "toggle", phase: "overall" },
    ] };
    expect(ids(t)).toEqual({ counter: "x2", choice: "climb", toggles: ["leave:mob", "defense:d", "broke:dc"] });
  });
  it("nothing that fits: no counter, no choice, no toggles", () => {
    const t: ScoutTemplate = { id: "ws:abc:2026:match", kind: "match", name: "Bare", fields: [{ id: "n", label: "Notes", type: "text", phase: "overall" }] };
    expect(ids(t)).toEqual({ counter: null, choice: null, toggles: [] });
  });
});

const tpl = builtinTemplate(2026, "match");
const WATCHED = [
  { team: 4410, side: "red", station: 1 }, { team: 18360, side: "red", station: 2 },
  { team: 23014, side: "blue", station: 1 }, { team: 7175, side: "blue", station: 2 },
] as const;

let calls: [number, Record<string, ScoutValue>][] = [];
let opened: number[] = [];
afterEach(() => { calls = []; opened = []; });

function Harness() {
  const [data, setData] = useState<Record<number, Record<string, ScoutValue>>>({});
  const teams: TeamState[] = WATCHED.map((w) => ({ watched: { ...w }, data: data[w.team] ?? {}, notes: "", status: data[w.team] ? "started" : "empty", entry: null, template: tpl }));
  return <QuickMatchForm teams={teams} template={tpl} onOpenFull={(t) => opened.push(t)}
    onChange={(team, d) => { calls.push([team, d]); setData((s) => ({ ...s, [team]: d })); }} />;
}

describe("QuickMatchForm", () => {
  it("shows one row per team, red first", () => {
    render(<Harness />);
    const rows = document.querySelectorAll("section[data-team]");
    expect([...rows].map((r) => r.getAttribute("data-team"))).toEqual(["4410", "18360", "23014", "7175"]);
    expect(rows[0].getAttribute("aria-label")).toBe("4410, red 1, nothing yet");
    expect(rows[2].getAttribute("aria-label")).toBe("23014, blue 1, nothing yet");
  });

  it("counts up and down for one team only", () => {
    render(<Harness />);
    const row = within(document.querySelector("section[data-team='18360']") as HTMLElement);
    const plus = row.getByRole("button", { name: /18360 Pollen \/ nectar scored: 0\. Add one/ });
    expect(row.getByRole("button", { name: /minus one/ })).toHaveProperty("disabled", true);
    fireEvent.click(plus); fireEvent.click(plus);
    fireEvent.click(row.getByRole("button", { name: /minus one/ }));
    expect(calls).toEqual([[18360, { pollen: 1 }], [18360, { pollen: 2 }], [18360, { pollen: 1 }]]);
    expect(row.getByRole("button", { name: /: 1\. Add one/ })).toBeTruthy();
  });

  it("keeps the rest of the record, flips toggles, picks and clears the choice", () => {
    render(<Harness />);
    const row = within(document.querySelector("section[data-team='7175']") as HTMLElement);
    fireEvent.click(row.getByRole("button", { name: "7175 Left start zone" }));
    fireEvent.click(row.getByRole("radio", { name: "Full" }));
    fireEvent.click(row.getByRole("button", { name: "7175 Broke down / disabled" }));
    expect(row.getByRole("button", { name: "7175 Broke down / disabled" }).getAttribute("aria-pressed")).toBe("true");
    expect(row.getByRole("radio", { name: "Full" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row.getByRole("radio", { name: "Full" }));
    expect(calls.at(-1)).toEqual([7175, { autoLeave: true, broke: true }]);
    fireEvent.click(row.getByRole("button", { name: "7175 Left start zone" }));
    expect(calls.at(-1)).toEqual([7175, { autoLeave: false, broke: true }]);
  });

  it("arrow keys move and pick the choice", () => {
    render(<Harness />);
    const row = within(document.querySelector("section[data-team='4410']") as HTMLElement);
    fireEvent.keyDown(row.getByRole("radio", { name: "None" }), { key: "ArrowRight" });
    expect(calls.at(-1)).toEqual([4410, { park: "Partial" }]);
    expect(document.activeElement?.textContent).toBe("Partial");
  });

  it("opens the full form for one team", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Full form for 23014" }));
    expect(opened).toEqual([23014]);
  });

  it("says so when the template has no scoring counter", () => {
    const bare: ScoutTemplate = { id: "x", kind: "match", name: "Bare", fields: [{ id: "defense", label: "Played defense", type: "toggle", phase: "teleop" }] };
    render(<QuickMatchForm teams={[{ watched: { team: 1, side: "red", station: 1 }, data: {}, notes: "", status: "empty", entry: null, template: bare }]} onChange={() => {}} onOpenFull={() => {}} />);
    expect(screen.getByText("No scoring counter in this template.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 Played defense" })).toBeTruthy();
  });
});
