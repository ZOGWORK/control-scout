// @vitest-environment jsdom
// A shared entry's card on a phone: with two assigned scouts (long names) its actions used to sit past the
// screen's edge. The card can't grow wider than its column, the long badge wraps, and the actions (named as
// a group for the entry) wrap under the details instead of being pushed out. jsdom has no layout, so this
// checks the structure that makes it wrap; the 390px geometry is checked in a browser (see the PR).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScoutEntry } from "../lib/scouting";
import { TooltipProvider } from "../components/ui/overlay";

vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, syncReady: false, state: { videoLinks: {} } }) }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { EntryCard, entryDate } = await import("./ScoutPage");

const entry = {
  uuid: "card00000001", season: 2025, team: 18360, eventCode: "USTST1", matchLabel: "Q12", kind: "match", data: {}, notes: "",
  workspaceId: "901", authorAccountId: 42, authorDisplayName: "Maximiliana Featherstonehaugh-Worthington", updatedAt: Date.now() - 60_000,
} as unknown as ScoutEntry;
const LONG = "Assigned to Bartholomew Montgomery-Fitzwilliam and Alexandria Konstantinopoulou";

afterEach(cleanup);

function show(over: Partial<{ onEdit: () => void; onHistory: () => void }> = {}) {
  const onEdit = over.onEdit ?? vi.fn(), onHistory = over.onHistory ?? vi.fn();
  render(
    <TooltipProvider><MemoryRouter>
      <ul className="grid gap-2 md:grid-cols-2">
        <EntryCard e={entry} assigned={LONG} canDelete readOnly={false} comments={2} onEdit={onEdit} onHistory={onHistory} />
      </ul>
    </MemoryRouter></TooltipProvider>,
  );
  return { onEdit, onHistory };
}

describe("a shared entry card with two assigned scouts", () => {
  it("keeps both scouts in the badge, which wraps instead of widening the card", () => {
    show();
    const badge = screen.getByText(LONG, { exact: false });
    expect(badge.textContent).toContain("Bartholomew Montgomery-Fitzwilliam and Alexandria Konstantinopoulou");
    expect(badge.className).toMatch(/whitespace-normal/);
    expect(badge.className).not.toMatch(/whitespace-nowrap/);
    expect(badge.className).toMatch(/max-w-full/);
    // A grid item is as wide as its longest unbreakable line unless min-width is 0.
    expect(screen.getByRole("listitem").className).toMatch(/\bmin-w-0\b/);
  });

  it("puts every action in one named group that wraps under the details when they don't fit", () => {
    const { onEdit, onHistory } = show();
    const actions = screen.getByRole("group", { name: "Entry 18360 · Match Q12" });
    expect(within(actions).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual([
      "2 comments: open the entry", "Edit", "Version history", "Delete entry",
    ]);
    const row = actions.parentElement!;
    expect(row.className).toMatch(/\bflex-wrap\b/);
    expect(actions.className).toMatch(/\bshrink-0\b/);
    // The details shrink (and truncate the attribution) rather than push the actions out.
    expect(row.firstElementChild!.className).toMatch(/\bmin-w-0\b/);
    fireEvent.click(within(actions).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(actions).getByRole("button", { name: "Version history" }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onHistory).toHaveBeenCalledOnce();
  });
});

describe("a personal entry's date", () => {
  const personal = (updatedAt: unknown) => ({ ...entry, uuid: "personal0001", workspaceId: null, updatedAt }) as unknown as ScoutEntry;
  const showPersonal = (e: ScoutEntry) => render(
    <TooltipProvider><MemoryRouter><ul><EntryCard e={e} assigned={null} canDelete readOnly={false} comments={0} onEdit={() => {}} onHistory={() => {}} /></ul></MemoryRouter></TooltipProvider>,
  );

  it("an updatedAt repaired to 0 (or missing) reads as unknown, never 1969", () => {
    for (const at of [0, undefined, null, Number.NaN]) {
      showPersonal(personal(at));
      const card = screen.getByRole("listitem");
      expect(card.textContent).toContain("USTST1 · Date unknown");
      expect(card.textContent).not.toMatch(/1969|1970/);
      cleanup();
    }
  });

  it("a real time still shows as a date", () => {
    const at = Date.UTC(2025, 10, 1, 15, 30);
    showPersonal(personal(at));
    expect(screen.getByRole("listitem").textContent).toContain(`USTST1 · ${new Date(at).toLocaleString()}`);
    expect(entryDate(at)).toBe(new Date(at).toLocaleString());
    expect(entryDate(9e15)).toBe("Date unknown"); // past Date's range
  });
});
