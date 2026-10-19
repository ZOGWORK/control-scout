// @vitest-environment jsdom
// What's new on a hand-written changelog: a release without a Highlights block falls back to its full notes
// (no empty digest, no toggle), and a highlight with an unknown tag still shows, with the default icon.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WhatsNewContent from "./WhatsNewContent";

vi.mock("../../CHANGELOG.md?raw", () => ({
  default: [
    "# Changelog", "",
    "## 2.1.0 — 2027-02-01", "", "With a digest.", "",
    "### Highlights", "- [home] A new home", "- [mystery] Something unexpected", "- Untagged line", "",
    "### Home", "- The long detail (#12)", "",
    "## 2.0.0 — 2027-01-02", "", "Written before digests.", "",
    "### Fixes", "- An older fix (#9)", "",
  ].join("\n"),
}));

afterEach(cleanup);

describe("What's new content", () => {
  it("shows every highlight, unknown tags included, before the folded full notes", () => {
    render(<WhatsNewContent />);
    for (const t of ["A new home", "Something unexpected", "Untagged line"]) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Full release notes" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/The long detail/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full release notes" }));
    expect(screen.getByText(/The long detail/)).toBeTruthy();
  });

  it("falls back to the full notes for a release with no highlights", () => {
    render(<WhatsNewContent />);
    fireEvent.click(screen.getByRole("button", { name: "v2.0.0" }));
    expect(screen.getByText("Written before digests.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Highlights" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Full release notes" })).toBeNull();
    expect(screen.getByText("Fixes")).toBeTruthy();
    expect(screen.getByRole("link", { name: "#9" })).toBeTruthy();
  });
});
