// @vitest-environment jsdom
// The bundle builder follows the owner's switches (GET /api/flags): event-day bundles off, or offline packs
// paused, hides it; both on shows it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { resetFlags } from "../../lib/flags";
import { DEFAULT_FLAGS } from "../../shared/flags";
import { EventBundles } from "./EventBundles";

vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { settings: {}, myTeam: null, tracked: { teams: [], events: [] } }, user: null, update: vi.fn() }) }));

const mount = () => render(<MemoryRouter><EventBundles /></MemoryRouter>);
afterEach(() => { cleanup(); resetFlags(); });

describe("EventBundles and the owner's switches", () => {
  it("shows with both on", () => {
    resetFlags({ ...DEFAULT_FLAGS }, true);
    mount();
    expect(screen.getByRole("heading", { name: "Event-day bundle" })).toBeTruthy();
  });

  it("hides with event-day bundles off", () => {
    resetFlags({ ...DEFAULT_FLAGS, eventBundle: false }, true);
    mount();
    expect(screen.queryByRole("heading", { name: "Event-day bundle" })).toBeNull();
  });

  it("hides with offline packs paused", () => {
    resetFlags({ ...DEFAULT_FLAGS, offlinePacks: false }, true);
    mount();
    expect(screen.queryByRole("heading", { name: "Event-day bundle" })).toBeNull();
  });
});
