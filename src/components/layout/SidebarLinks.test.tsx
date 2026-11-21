// @vitest-environment jsdom
// The sidebar's links block: About (Settings › About), Donate and Privacy Policy, no API link, and round buttons whose
// addresses all come from the site's existing constants (never typed in again here).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SIDEBAR_LINKS, SidebarLinks, sidebarSocials } from "./SidebarLinks";
import { REPO_URL } from "../../shared/footer";
import { discordInviteUrl } from "../../shared/discord";
import { PRIVATE_EMAIL } from "./BugReport";

afterEach(cleanup);

const renderLinks = (place?: "sidebar" | "sheet") => render(<MemoryRouter><SidebarLinks place={place} /></MemoryRouter>);

describe("SidebarLinks", () => {
  it("shows About, Donate and Privacy Policy to their pages, in that order", () => {
    renderLinks();
    const nav = screen.getByRole("navigation", { name: "About Control Scout" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["About", "/settings#about"],
      ["Donate", "/donate"],
      ["Privacy Policy", "/privacy"],
    ]);
  });

  it("has no API link", () => {
    renderLinks();
    expect(screen.queryByRole("link", { name: /\bapi\b/i })).toBeNull();
    expect(SIDEBAR_LINKS.some((l) => /api/i.test(l.label) || /api/i.test(l.to))).toBe(false);
    expect(sidebarSocials().some((s) => /\/api\b|\bapi\b/i.test(s.href + " " + s.label))).toBe(false);
  });

  it("links the round buttons to the existing GitHub, Discord, email and status addresses", () => {
    renderLinks();
    expect(screen.getByRole("link", { name: "Control Scout on GitHub" }).getAttribute("href")).toBe(REPO_URL);
    expect(screen.getByRole("link", { name: "Add the Control Scout bot to Discord" }).getAttribute("href")).toBe(discordInviteUrl());
    expect(screen.getByRole("link", { name: "Email Control Scout" }).getAttribute("href")).toBe(`mailto:${PRIVATE_EMAIL}`);
    expect(screen.getByRole("link", { name: "Site status" }).getAttribute("href")).toBe("/status");
  });

  it("opens outside sites in a new tab, but not the email or the site's own pages", () => {
    renderLinks();
    expect(screen.getByRole("link", { name: "Control Scout on GitHub" }).getAttribute("target")).toBe("_blank");
    expect(screen.getByRole("link", { name: "Control Scout on GitHub" }).getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("link", { name: "Email Control Scout" }).getAttribute("target")).toBeNull();
    expect(screen.getByRole("link", { name: "Site status" }).getAttribute("target")).toBeNull();
  });

  it("gives every round button a 44px link box", () => {
    renderLinks("sheet");
    for (const name of ["Control Scout on GitHub", "Add the Control Scout bot to Discord", "Email Control Scout", "Site status"]) {
      expect(screen.getByRole("link", { name }).className).toContain("size-11");
    }
  });

  it("leaves out Discord without a bot client ID and Status while the status page is off", () => {
    const rows = sidebarSocials({ discord: discordInviteUrl(null), status: false });
    expect(rows.map((r) => r.label)).toEqual(["Control Scout on GitHub", "Email Control Scout"]);
  });

  it("never links YouTube", () => {
    renderLinks();
    expect(screen.getAllByRole("link").some((l) => /youtube|youtu\.be/i.test(l.getAttribute("href") ?? ""))).toBe(false);
  });
});
