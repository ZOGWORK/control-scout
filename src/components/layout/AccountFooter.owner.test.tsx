// @vitest-environment jsdom
// The owner console's link sits right above the owner's name in the sidebar (an icon in the rail), and is
// never rendered for anyone else: a signed-in account that isn't the owner, or nobody signed in.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock("../../lib/personal", async (orig) => ({ ...(await orig<typeof import("../../lib/personal")>()), usePersonal: () => ({ user: h.user, sync: "synced", offlineAccount: false, signOut: async () => {} }) }));

const { AccountFooter, AccountProvider } = await import("./AccountMenu");
const { TooltipProvider } = await import("../ui/overlay");
const mount = (place: "sidebar" | "rail" | "sheet") =>
  render(<TooltipProvider><MemoryRouter><AccountProvider><AccountFooter place={place} /></AccountProvider></MemoryRouter></TooltipProvider>);

afterEach(cleanup);

describe("owner console link", () => {
  it("shows above the owner's name, linking to /owner", () => {
    h.user = { id: 1, email: "owner@example.test", displayName: "Sushil", createdAt: "", isOwner: true };
    const { container } = mount("sidebar");
    const link = screen.getByRole("link", { name: /Owner console/ });
    expect(link.getAttribute("href")).toBe("/owner");
    // Above the account row: it comes before the name in the document.
    const name = screen.getByText("Sushil");
    expect(link.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("[data-owner-console]")).toHaveLength(1);
  });

  it("is an icon in the rail", () => {
    h.user = { id: 1, email: "owner@example.test", displayName: "Sushil", createdAt: "", isOwner: true };
    mount("rail");
    expect(screen.getByRole("link", { name: "Owner console" }).getAttribute("href")).toBe("/owner");
  });

  it("is never rendered for anyone else", () => {
    for (const user of [{ id: 2, email: "scout@example.test", displayName: "Priya", createdAt: "" }, null]) {
      h.user = user;
      for (const place of ["sidebar", "rail", "sheet"] as const) {
        const { container } = mount(place);
        expect(container.querySelector("[data-owner-console]"), `${place} ${user ? "signed in" : "signed out"}`).toBeNull();
        cleanup();
      }
    }
  });
});
