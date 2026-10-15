// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { markOffline } from "../lib/offline/saved";

const apiFetch = vi.fn();
vi.mock("../lib/api", () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));
const { TeamInput, lookupTeamName } = await import("./TeamInput");

afterEach(() => { cleanup(); apiFetch.mockReset(); });

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
});
