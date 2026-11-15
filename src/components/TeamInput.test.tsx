// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { markOffline } from "../lib/offline/saved";

const apiFetch = vi.fn();
class ApiError extends Error { constructor(readonly status: number, message: string, readonly offline = false) { super(message); } }
vi.mock("../lib/api", () => ({ ApiError, apiFetch: (...a: unknown[]) => apiFetch(...a), peek: () => undefined }));
// The names in the packs saved on this device (lib/offline/names.ts), and whether the connection check knows it's offline.
const savedTeamName = vi.fn(async (_n: number): Promise<string | undefined> => undefined);
vi.mock("../lib/offline/names", () => ({ savedTeamName: (n: number) => savedTeamName(n) }));
let offline = false;
vi.mock("../lib/connection", () => ({ offlineNow: () => offline }));
const { TeamInput, lookupTeamName } = await import("./TeamInput");

afterEach(() => { cleanup(); apiFetch.mockReset(); savedTeamName.mockReset(); savedTeamName.mockResolvedValue(undefined); offline = false; });

describe("TeamInput", () => {
  it("marks the field invalid and points it at the error message", () => {
    render(<TeamInput label="Your team number" value="" onChange={() => {}} error="Enter a team number." />);
    const input = screen.getByRole("textbox", { name: "Your team number" });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const msg = screen.getByRole("alert");
    expect(msg.textContent).toBe("Enter a team number.");
    expect(msg.className).toContain("text-destructive");
    expect(input.getAttribute("aria-describedby")).toBe(msg.id);
  });
  it("is not invalid without an error", () => {
    render(<TeamInput label="Add a team" value="" onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Add a team" });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("lookupTeamName", () => {
  it("takes the server's word: a hit is the name, a miss is null (and both are cached)", async () => {
    apiFetch.mockResolvedValueOnce({ hits: [{ kind: "team", ref: "4215", title: "4215 Hypnotic Robotics" }] });
    expect(await lookupTeamName(4215)).toBe("Hypnotic Robotics");
    apiFetch.mockResolvedValueOnce({ hits: [] });
    expect(await lookupTeamName(98765)).toBeNull();
    expect(await lookupTeamName(98765)).toBeNull();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
  it("treats a miss in an offline answer (saved seasons only) as unknown, and doesn't cache it", async () => {
    apiFetch.mockResolvedValue(markOffline({ hits: [] }, { season: 2025, savedAt: 1, dataAsOf: null }));
    expect(await lookupTeamName(55555)).toBeUndefined();
    expect(await lookupTeamName(55555)).toBeUndefined();
    expect(apiFetch).toHaveBeenCalledTimes(2);
  });
  it("is unknown when the lookup fails or runs past its deadline", async () => {
    apiFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await lookupTeamName(44444)).toBeUndefined();
    apiFetch.mockReturnValueOnce(new Promise(() => {}));
    expect(await lookupTeamName(33333, 20)).toBeUndefined();
  });
  // Measured on 6.5.1: with only an event pack saved, offline Predict showed "…" under all four boxes, because the
  // name came from a search no saved data answers. The pack's own names (the ones its prediction shows) fill in.
  it("with no signal, names the team from a saved pack (never cached, and never online for a server error)", async () => {
    savedTeamName.mockImplementation(async (n) => (n === 10653 ? "Dragatrons" : n === 7 ? "" : undefined));
    apiFetch.mockRejectedValue(new ApiError(0, "You're offline.", true));
    expect(await lookupTeamName(10653)).toBe("Dragatrons");
    expect(await lookupTeamName(7)).toBe(""); // in the pack with no name: "Unnamed team", as online
    expect(await lookupTeamName(22222)).toBeUndefined(); // not in any pack: can't tell, never "not a team"
    // A saved season's search answer that misses the team: the pack still names it.
    apiFetch.mockResolvedValueOnce(markOffline({ hits: [] }, { season: 2026, savedAt: 1, dataAsOf: null }));
    expect(await lookupTeamName(10653)).toBe("Dragatrons");
    // The server answered with an error: no pack is opened for that.
    savedTeamName.mockClear();
    apiFetch.mockRejectedValueOnce(new ApiError(500, "Server error"));
    expect(await lookupTeamName(10653)).toBeUndefined();
    expect(savedTeamName).not.toHaveBeenCalled();
    // The server's answer once it's back.
    apiFetch.mockResolvedValueOnce({ hits: [{ kind: "team", ref: "10653", title: "10653 Dragatrons II" }] });
    expect(await lookupTeamName(10653)).toBe("Dragatrons II");
  });
  it("known to be offline: the pack's name at once, without asking the server", async () => {
    offline = true;
    savedTeamName.mockResolvedValue("Bionic Brood");
    expect(await lookupTeamName(33429)).toBe("Bionic Brood");
    expect(apiFetch).not.toHaveBeenCalled();
    // Not in a pack: the search still gets its try (a saved season may hold it).
    savedTeamName.mockResolvedValue(undefined);
    apiFetch.mockResolvedValueOnce(markOffline({ hits: [{ kind: "team", ref: "4", title: "4 Four" }] }, { season: 2026, savedAt: 1, dataAsOf: null }));
    expect(await lookupTeamName(4)).toBe("Four");
  });
  it("shows the pack's name under the box with no signal", async () => {
    offline = true;
    savedTeamName.mockResolvedValue("Fabricators");
    render(<TeamInput label="Blue team 1" value="5386" onChange={() => {}} />);
    expect(screen.getByText("…")).toBeTruthy();
    expect(await screen.findByText("Fabricators", {}, { timeout: 2000 })).toBeTruthy();
  });
});
