// @vitest-environment jsdom
// /supporters: public sponsors by name with their start month, private ones as one count, never an amount;
// "Not set up yet" with no GitHub token on the server, "No supporters yet" when nobody has sponsored.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { SupportersResponse } from "../shared/sponsor";

let data: SupportersResponse | undefined;
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useTitle: () => {} }));
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data, error: undefined, loading: false, reload: async () => {} }) }));
const { default: SupportersPage } = await import("./SupportersPage");
const mount = () => render(<MemoryRouter><SupportersPage /></MemoryRouter>);
afterEach(cleanup);

describe("Supporters page", () => {
  it("lists public sponsors and counts the anonymous ones", () => {
    data = { configured: true, anonymous: 3, updatedAt: "2026-12-10T00:00:00Z", supporters: [
      { login: "amy", name: null, since: "2026-11-10T00:00:00Z" },
      { login: "bea", name: "Bea B", since: "2026-11-20T00:00:00Z" },
    ] };
    const { container } = mount();
    expect(screen.getByRole("link", { name: "amy" }).getAttribute("href")).toBe("https://github.com/amy");
    expect(screen.getByRole("link", { name: "Bea B" })).toBeTruthy();
    expect(screen.getAllByText("Since Nov 2026").length).toBe(2);
    expect(screen.getByText("3 anonymous supporters")).toBeTruthy();
    expect(container.textContent).not.toMatch(/[$€£]\s?\d/);
  });

  it("says when it isn't set up, and when nobody has sponsored yet", () => {
    data = { configured: false, supporters: [], anonymous: 0, updatedAt: null };
    mount();
    expect(screen.getByText("Not set up yet")).toBeTruthy();
    cleanup();
    data = { configured: true, supporters: [], anonymous: 0, updatedAt: "2026-12-10T00:00:00Z" };
    mount();
    expect(screen.getByText("No supporters yet")).toBeTruthy();
  });
});
