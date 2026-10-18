// @vitest-environment jsdom
// What's new: opening it (from anywhere) shows Scout's own releases from CHANGELOG.md, newest first and
// marked Latest; picking another version shows that release; PR numbers link to this repo's pull requests.
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { openWhatsNew, WhatsNewHost, WhatsNewRow } from "./WhatsNew";

afterEach(cleanup);

describe("What's new", () => {
  it("opens from a row and lists Scout's releases, the latest first", async () => {
    render(<><WhatsNewRow /><WhatsNewHost /></>);
    fireEvent.click(screen.getByRole("button", { name: /What's new/ }));
    const rail = await screen.findByRole("navigation", { name: "Releases" });
    const versions = [...rail.querySelectorAll("button")].map((b) => b.textContent);
    expect(versions[0]).toBe(`v${pkg.version}Latest`);
    expect(versions).toContain("v1.6.0");
    expect(screen.getByText(`v${pkg.version} · 2026-10-18`)).toBeTruthy();
    // Its PRs link to this repository.
    const pr = screen.getByRole("link", { name: "#151" });
    expect(pr.getAttribute("href")).toBe("https://github.com/Control-Point-FTC/control-scout/pull/151");
  });

  it("shows another release when its version is picked", async () => {
    render(<WhatsNewHost />);
    act(() => openWhatsNew());
    fireEvent.click(await screen.findByRole("button", { name: "v1.6.0" }));
    expect(screen.getByText("v1.6.0 · 2026-10-16")).toBeTruthy();
    expect(screen.getByRole("button", { name: "v1.6.0" }).getAttribute("aria-current")).toBe("true");
  });
});
