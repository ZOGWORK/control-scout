// @vitest-environment jsdom
// A feature the owner switched off answers 403 {error: "feature_disabled", feature}: the app keeps that code on the
// error, tells it apart from a 403 that means "no access", shows a calm "switched off for now" (never an error with
// Try again), and the shared views that would otherwise say "you can't reach this workspace" say it's paused.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError, isAccessDenied, isFeatureDisabled } from "./api";
import { ErrorState } from "../components/states";

vi.mock("../components/layout/Search", () => ({ useSearch: () => ({ open: () => {} }) }));

const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ApiError and feature_disabled", () => {
  it("carries the code, the feature and the server's own words", async () => {
    answer(403, { error: "feature_disabled", feature: "livePredictions", message: "Live predictions are switched off for now." });
    const e = await apiFetch("/api/predict/match?red=1,2&blue=3,4").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 403, code: "feature_disabled", feature: "livePredictions", message: "Live predictions are switched off for now." });
    expect(isFeatureDisabled(e)).toBe(true);
    expect(isFeatureDisabled(e, "livePredictions")).toBe(true);
    expect(isFeatureDisabled(e, "coinFlips")).toBe(false);
    expect(isAccessDenied(e)).toBe(false);
  });

  it("a plain 403 is no access, never feature_disabled", async () => {
    answer(403, { error: "You're not a member of this workspace in Control Point." });
    const e = (await apiFetch("/api/scout/sync?workspaceId=1").catch((x: unknown) => x)) as ApiError;
    expect(isFeatureDisabled(e)).toBe(false);
    expect(isAccessDenied(e)).toBe(true);
    expect(e.message).toBe("You're not a member of this workspace in Control Point.");
  });

  it("ErrorState shows a switched-off feature as switched off for now, with no Try again", () => {
    const retry = vi.fn();
    render(<ErrorState error={new ApiError(403, "Power rankings are switched off for now.", false, "feature_disabled", "powerRankings")} onRetry={retry} />);
    expect(screen.getByText("Switched off for now")).toBeTruthy();
    expect(screen.getByText("Power rankings are switched off for now.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<ErrorState error={new ApiError(500, "Boom")} onRetry={retry} />);
    expect(screen.getByText("Couldn't load this")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });
});
