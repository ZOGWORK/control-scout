// @vitest-environment jsdom
// Search inside All listed, with the real cached reads (useApi): an older search's answer that arrives
// after a newer one can never replace it on screen, whichever order the server answers in.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invalidate } from "../../lib/api";
import type { DirectoryPage, DirectoryTeam } from "../../shared/directory";

vi.mock("../../lib/personal", () => ({ useTeamFlags: () => ({ tracked: false, toggleTracked: () => {} }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
const { TeamDirectory } = await import("./TeamDirectory");

const MAPLE: DirectoryTeam = { team: 30, name: "Maple", city: "Toronto", state: "ON", country: "Canada", rookieYear: 2022, hasResults: false };
const MOOSE: DirectoryTeam = { team: 31, name: "Moose", city: null, state: null, country: "Canada", rookieYear: null, hasResults: true };
const page = (q: string | null, rows: DirectoryTeam[]): DirectoryPage => ({
  season: 2025, country: "CA", q, total: 2, withResults: 1, matched: rows.length, unplaced: 0, page: 1, pageSize: 50, sort: "team", dir: "asc",
  readiness: { state: "ready", resultsAt: "2026-10-17T12:00:00Z", statsAt: "2026-10-17T12:05:00Z" }, rows,
});
const url = (q?: string) => `/api/directory/2025?country=CA${q ? `&q=${q}` : ""}&sort=team&dir=asc&page=1&pageSize=50`;

// Each request waits until the test answers it.
const pending = new Map<string, (body: DirectoryPage) => void>();
beforeEach(() => {
  pending.clear();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn((path: string) => new Promise<Response>((done) => {
    pending.set(path, (body) => done(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } })));
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); invalidate("/api/"); });

describe("TeamDirectory search: answers out of order", () => {
  it("keeps the newest search's answer when an older one lands after it", async () => {
    render(<MemoryRouter initialEntries={["/teams?view=listed&season=2025&country=CA"]}><TeamDirectory season={2025} onSeason={() => {}} /></MemoryRouter>);
    await waitFor(() => expect(pending.has(url())).toBe(true));
    pending.get(url())!(page(null, [MAPLE, MOOSE]));
    await screen.findByText("Maple");

    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "m" } });
    await waitFor(() => expect(pending.has(url("m"))).toBe(true));
    fireEvent.change(box, { target: { value: "moose" } });
    await waitFor(() => expect(pending.has(url("moose"))).toBe(true));

    pending.get(url("moose"))!(page("moose", [MOOSE]));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1 of 2 teams match “moose”"));
    pending.get(url("m"))!(page("m", [MAPLE, MOOSE])); // the older search answers last
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("status").textContent).toBe("1 of 2 teams match “moose”");
    expect(screen.queryByText("Maple")).toBeNull();
    expect((box as HTMLInputElement).value).toBe("moose");
  });
});
