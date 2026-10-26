// @vitest-environment jsdom
// The match's tabs and its one Save: a tab per team with its state, arrow keys between them; Save names the
// match, the team count and the next match, asks about teams with nothing yet, and moves on after a save.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";

const toasts: string[] = [];
vi.mock("../../ui/sonner", () => ({ toast: { success: (t: string) => toasts.push(t) } }));
const { SaveMatchBar, emptyHint } = await import("./SaveMatchBar");
const { TeamTabs } = await import("./TeamTabs");
import type { TeamTab } from "./TeamTabs";
import type { MatchSaveResult } from "../../../lib/matchDraft";

afterEach(() => { cleanup(); toasts.length = 0; });

const tabs: TeamTab[] = [
  { watched: { team: 4410, side: "red", station: 1 }, status: "empty" },
  { watched: { team: 18360, side: "red", station: 2 }, status: "done" },
  { watched: { team: 7175, side: "blue", station: 1 }, status: "started" },
];

describe("TeamTabs", () => {
  function Harness() {
    const [active, setActive] = useState(4410);
    return <TeamTabs teams={tabs} active={active} onSelect={setActive} renderForm={(t) => <p>Form for {t.team}</p>} />;
  }
  it("shows a tab per team with its state, and the open team's form", () => {
    render(<Harness />);
    const all = screen.getAllByRole("tab");
    expect(all.map((t) => t.getAttribute("aria-label"))).toEqual(["4410, red 1, nothing yet", "18360, red 2, saved", "7175, blue 1, started"]);
    expect(all[0].getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Form for 4410");
    fireEvent.click(all[2]);
    expect(screen.getByRole("tabpanel").textContent).toBe("Form for 7175");
  });
  it("arrow keys move between tabs, wrapping", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getAllByRole("tab")[0], { key: "ArrowLeft" });
    expect(screen.getByRole("tabpanel").textContent).toBe("Form for 7175");
    expect(document.activeElement).toBe(screen.getAllByRole("tab")[2]);
    fireEvent.keyDown(screen.getAllByRole("tab")[2], { key: "ArrowRight" });
    expect(screen.getByRole("tabpanel").textContent).toBe("Form for 4410");
  });
  it("one team: just its form, no tab list", () => {
    render(<TeamTabs teams={[tabs[0]]} active={4410} onSelect={() => {}} renderForm={(t) => <p>Form for {t.team}</p>} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getByText("Form for 4410")).toBeTruthy();
  });
});

describe("SaveMatchBar", () => {
  const ok = (saved: number, skipped: number[] = []): MatchSaveResult => ({ ok: true, saved, unchanged: 0, skipped });
  it("saves the match and moves on: toast says what was kept", () => {
    const onSave = vi.fn(() => ok(2)), onSaved = vi.fn();
    render(<SaveMatchBar label="Q14" teamCount={2} nextLabel="Q15" nextIndex={14} emptyTeams={[]} onSave={onSave} onSaved={onSaved} />);
    const btn = screen.getByRole("button", { name: /Save Q14/ });
    expect(btn.textContent).toBe("Save Q14· 2 teams → Q15");
    expect(screen.getByText(emptyHint([]))).toBeTruthy();
    fireEvent.click(btn);
    expect(onSave).toHaveBeenCalledWith({ includeEmpty: false });
    expect(onSaved).toHaveBeenCalledWith(14);
    expect(toasts).toEqual(["Saved Q14 · 2 entries. Now Q15."]);
  });

  it("asks about a team with nothing yet: save anyway, or skip it", () => {
    const onSave = vi.fn(() => ok(2)), onSaved = vi.fn();
    render(<SaveMatchBar label="Q14" teamCount={2} nextLabel="Q15" nextIndex={14} emptyTeams={[4410]} onSave={onSave} onSaved={onSaved} />);
    expect(screen.getByText("4410 has nothing yet. Save anyway, or fill it in first.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Save Q14/ }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("4410 has nothing yet. Save anyway, or fill it in first.");
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    expect(onSave).toHaveBeenLastCalledWith({ includeEmpty: true });
    fireEvent.click(screen.getByRole("button", { name: /Save Q14/ }));
    fireEvent.click(screen.getByRole("button", { name: "Skip 4410" }));
    expect(onSave).toHaveBeenLastCalledWith({ includeEmpty: false });
    expect(onSaved).toHaveBeenCalledTimes(2);
  });

  it("no Skip when every team is empty; the list reads naturally", () => {
    render(<SaveMatchBar label="Q14" teamCount={3} nextLabel={null} nextIndex={13} emptyTeams={[1, 2, 3]} onSave={() => ok(3)} onSaved={() => {}} />);
    expect(screen.getByRole("button", { name: /Save Q14/ }).textContent).toBe("Save Q14· 3 teams");
    fireEvent.click(screen.getByRole("button", { name: /Save Q14/ }));
    expect(screen.queryByRole("button", { name: /Skip/ })).toBeNull();
    expect(emptyHint([1, 2, 3])).toBe("1, 2 and 3 have nothing yet. Save anyway, or fill them in first.");
  });

  it("a storage error shows under Save and doesn't move on", () => {
    const onSaved = vi.fn();
    render(<SaveMatchBar label="Q14" teamCount={1} nextLabel="Q15" nextIndex={14} emptyTeams={[]} onSave={() => ({ ok: false, saved: 0, error: "This device couldn't save the entry." })} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: /Save Q14/ }));
    expect(screen.getByRole("alert").textContent).toBe("This device couldn't save the entry.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
  });

  it("a read-only workspace saves to Personal", () => {
    render(<SaveMatchBar label="Q14" teamCount={1} nextLabel="Q15" nextIndex={14} emptyTeams={[]} toPersonal onSave={() => ok(1)} onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Save Q14 to Personal/ }));
    expect(toasts).toEqual(["Kept in Personal: the workspace is read-only. Saved Q14 · 1 entry. Now Q15."]);
  });
});
