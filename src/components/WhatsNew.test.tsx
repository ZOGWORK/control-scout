// @vitest-environment jsdom
// What's new: opening it (from anywhere) shows Scout's own releases from CHANGELOG.md, newest first and
// marked Latest. Each release opens on its short highlights; "Full release notes" expands the detail, where
// PR numbers link to this repo's pull requests. Picking another version shows that release.
import { cleanup, fireEvent, render, screen, act, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json";
import md from "../../CHANGELOG.md?raw";
import { currentRelease, parseChangelog } from "../lib/changelog";

// The newest release, as CHANGELOG.md has it (so a new release doesn't need this test rewritten).
const latest = parseChangelog(md)[0];
const latestPr = latest.groups.flatMap((g) => g.items).join(" ").match(/#(d+)/)?.[1] ?? null;
import { openWhatsNew, WhatsNewHost, WhatsNewRow } from "./WhatsNew";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("What's new", () => {
  it("opens from a row and lists Scout's releases, the latest first", async () => {
    render(<><WhatsNewRow /><WhatsNewHost /></>);
    fireEvent.click(screen.getByRole("button", { name: /What's new/ }));
    const rail = await screen.findByRole("navigation", { name: "Releases" });
    const versions = [...rail.querySelectorAll("button")].map((b) => b.textContent);
    expect(versions[0]).toBe(`v${pkg.version}Latest`);
    expect(versions).toContain("v1.6.0");
    expect(screen.getByText(`v${pkg.version} · ${latest.date}`)).toBeTruthy();
  });

  it("is a named dialog that opens on the release's highlights, with the full notes one click away", async () => {
    render(<WhatsNewHost />);
    act(() => openWhatsNew());
    const dialog = await screen.findByRole("dialog", { name: /^What's new/ });
    const highlights = await within(dialog).findByRole("list", { name: "Highlights" });
    expect(within(highlights).getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
    expect(within(highlights).getByText(latest.highlights[0].text)).toBeTruthy();
    // The long detail waits behind the expansion.
    const more = within(dialog).getByRole("button", { name: "Full release notes" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    if (latestPr) expect(within(dialog).queryByRole("link", { name: `#${latestPr}` })).toBeNull();
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const notes = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(notes.hidden).toBe(false);
    expect(within(notes).getByText(latest.groups[0].heading)).toBeTruthy();
    // Its PRs link to this repository.
    if (latestPr) expect(within(notes).getByRole("link", { name: `#${latestPr}` }).getAttribute("href")).toBe(`https://github.com/Control-Point-FTC/control-scout/pull/${latestPr}`);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(notes.hidden).toBe(true);
  });

  it("holds focus while open and gives it back to what opened it when it closes", async () => {
    render(<><WhatsNewRow /><WhatsNewHost /></>);
    const row = screen.getByRole("button", { name: /What's new/ });
    row.focus();
    fireEvent.click(row);
    await screen.findByRole("navigation", { name: "Releases" });
    const dialog = screen.getByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it("shows another release when its version is picked, folded to its highlights again", async () => {
    render(<WhatsNewHost />);
    act(() => openWhatsNew());
    fireEvent.click(await screen.findByRole("button", { name: "Full release notes" }));
    fireEvent.click(screen.getByRole("button", { name: "v1.6.0" }));
    expect(screen.getByText("v1.6.0 · 2026-10-16")).toBeTruthy();
    expect(screen.getByRole("button", { name: "v1.6.0" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Full release notes" }).getAttribute("aria-expanded")).toBe("false");
    // The release scrolls on its own: a named region in the tab order, so a keyboard can scroll it.
    expect(screen.getByRole("region", { name: "Release v1.6.0" }).getAttribute("tabindex")).toBe("0");
  });

  it("clears the new-release dot on opening, and keeps every release listed", async () => {
    const v = currentRelease();
    render(<><WhatsNewRow /><WhatsNewHost /></>);
    if (v) expect(screen.getByRole("button", { name: "What's new (new release)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /What's new/ }));
    const rail = await screen.findByRole("navigation", { name: "Releases" });
    // (The row sits behind the open dialog, hidden from assistive tech meanwhile.)
    expect(screen.getByRole("button", { name: "What's new", hidden: true })).toBeTruthy();
    if (v) expect(localStorage.getItem("cs-whats-new-seen")).toBe(v);
    expect(within(rail).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining(["v1.6.0", "v1.5.0"]));
  });
});
