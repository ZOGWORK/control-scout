// @vitest-environment jsdom
// Each field type in its big form: a counter adds 1 per tap within min/max (showing its floor until
// touched), a yes/no flips, a choice or rating picks one and tapping it again clears it, text types.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ScoutField } from "../../../shared/scoutTemplate";
import type { ScoutValue } from "../../../lib/scouting";
import { BigFieldInput, counterRange, type FieldTone } from "./BigFieldInput";

afterEach(cleanup);

let seen: (ScoutValue | undefined)[] = [];
function Harness({ f, start, tone }: { f: ScoutField; start?: ScoutValue; tone?: FieldTone }) {
  const [v, setV] = useState<ScoutValue | undefined>(start);
  return <BigFieldInput f={f} value={v} tone={tone} onChange={(n) => { seen.push(n); setV(n); }} />;
}
afterEach(() => { seen = []; });

describe("counter", () => {
  const f: ScoutField = { id: "pollen", label: "Pollen scored", type: "counter", phase: "teleop", max: 3 };
  it("adds one per tap, stops at max, and announces its value", () => {
    render(<Harness f={f} />);
    const plus = screen.getByRole("button", { name: /Pollen scored: 0\. Add one/ });
    expect(screen.getByRole("button", { name: "Pollen scored minus one" })).toHaveProperty("disabled", true);
    fireEvent.click(plus); fireEvent.click(plus); fireEvent.click(plus);
    expect(seen).toEqual([1, 2, 3]);
    expect(screen.getByRole("button", { name: /Pollen scored: 3/ })).toHaveProperty("disabled", true);
    expect(screen.getByText("Most is 3")).toBeTruthy();
    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Pollen scored: 3");
  });
  it("minus takes one off and never goes under the floor", () => {
    render(<Harness f={f} start={1} />);
    const minus = screen.getByRole("button", { name: "Pollen scored minus one" });
    fireEvent.click(minus);
    expect(seen).toEqual([0]);
    expect(minus).toHaveProperty("disabled", true);
  });
  it("a counter with a minimum shows it until touched, and the first tap goes up from there", () => {
    const g: ScoutField = { ...f, min: 2, max: 5 };
    expect(counterRange(g, undefined)).toEqual({ lo: 2, hi: 5, n: 2 });
    render(<Harness f={g} />);
    fireEvent.click(screen.getByRole("button", { name: /Pollen scored: 2\. Add one/ }));
    expect(seen).toEqual([3]);
    fireEvent.click(screen.getByRole("button", { name: "Pollen scored minus one" }));
    expect(seen).toEqual([3, 2]);
    expect(screen.getByRole("button", { name: "Pollen scored minus one" })).toHaveProperty("disabled", true);
  });
});

describe("toggle", () => {
  const f: ScoutField = { id: "broke", label: "Broke down", type: "toggle", phase: "overall" };
  it("flips between No and Yes as a pressed button", () => {
    render(<Harness f={f} />);
    const b = screen.getByRole("button", { name: "Broke down" });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(b.textContent).toContain("No");
    fireEvent.click(b);
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.textContent).toContain("Yes");
    fireEvent.click(b);
    expect(seen).toEqual([true, false]);
  });
  it("the bad tone shows a Yes in the danger colour", () => {
    render(<Harness f={f} start={true} tone="bad" />);
    expect(screen.getByRole("button", { name: "Broke down" }).className).toContain("border-danger");
  });
});

describe("choice and rating", () => {
  it("a choice picks one option and tapping it again clears it", () => {
    render(<Harness f={{ id: "park", label: "End park", type: "choice", phase: "endgame", options: ["None", "Partial", "Full"] }} />);
    expect(screen.getByRole("radiogroup", { name: "End park" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Partial" }));
    expect(screen.getByRole("radio", { name: "Partial" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    fireEvent.click(screen.getByRole("radio", { name: "Full" }));
    expect(seen).toEqual(["Partial", "Full", undefined]);
  });
  it("a rating is buttons 1 to max holding a number", () => {
    render(<Harness f={{ id: "driver", label: "Driver skill", type: "rating", phase: "overall", max: 4 }} />);
    expect(screen.getAllByRole("radio").map((b) => b.textContent)).toEqual(["1", "2", "3", "4"]);
    fireEvent.click(screen.getByRole("radio", { name: "3" }));
    expect(seen).toEqual([3]);
  });
});

it("text is a labelled input", () => {
  render(<Harness f={{ id: "intake", label: "Intake type", type: "text", phase: "pit" }} />);
  fireEvent.change(screen.getByLabelText("Intake type"), { target: { value: "roller" } });
  expect(seen).toEqual(["roller"]);
});

it("disabled turns every control off", () => {
  render(<BigFieldInput f={{ id: "c", label: "C", type: "counter", phase: "auto" }} value={1} onChange={() => {}} disabled />);
  for (const b of screen.getAllByRole("button")) expect(b).toHaveProperty("disabled", true);
});
