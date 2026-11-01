// Tests of the Scout page's entry list, filters, forms and views: a /scout link with no tab or view opens
// Entries, where the entry list and "Type a match in" live (Event day has its own tests).
import { fireEvent, screen } from "@testing-library/react";

export const asEntries = (url: string) => (/[?&](tab|view)=/.test(url) ? url : `${url}${url.includes("?") ? "&" : "?"}tab=entries`);

/**
 * Fills in an open entry form's team (picked from the team box by its number) and, for a match form whose match
 * is still empty, a match (the form requires one).
 */
export function fillTeam(team: string, match = "Q1") {
  const box = screen.queryByRole("combobox", { name: "Team" });
  // A team already picked: change it first.
  if (!box) fireEvent.click(screen.getByRole("button", { name: /^Change team/ }));
  const input = screen.getByRole("combobox", { name: "Team" });
  fireEvent.change(input, { target: { value: team } });
  fireEvent.keyDown(input, { key: "Enter" });
  const m = screen.queryByLabelText("Match") as HTMLInputElement | null;
  if (m && !m.value) fireEvent.change(m, { target: { value: match } });
}

/** A picked event on this device for each space (a new entry needs one: it's where the entry is). */
export function pickedEvent(spaces: (string | null)[], eventCode = "USNJQ1", season = 2025) {
  for (const s of spaces) localStorage.setItem(`cs-scout-session:${s ?? "personal"}`, JSON.stringify({ season, eventCode, watching: { kind: "alliance", side: "red" }, setAt: Date.now() }));
}

/** The event an open entry form says it's at (never typed: the picked event, else the workspace's default; "" for none). */
export function formEvent() {
  const t = screen.getByRole("form", { name: /entry/ }).textContent ?? "";
  return /No event/.test(t) ? "" : t.match(/At (?:[^·]*· )?([A-Z0-9]{4,}?)(?=[A-Z][a-z]|$)/)?.[1] ?? "";
}
