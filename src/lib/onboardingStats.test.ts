// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetConsent, setAnalyticsConsent } from "./consent";
import { endOnboarding, moveOnboarding, openOnboarding, resetOnboarding } from "./onboarding";

const sent: string[] = [];
beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetOnboarding();
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: vi.fn((url: string, body: Blob) => { sent.push(url); bodies.push(body); return true; }),
  });
});
const bodies: Blob[] = [];
beforeEach(() => { bodies.length = 0; });
const read = async () => Promise.all(bodies.map(async (b) => JSON.parse(await b.text()) as Record<string, unknown>));

describe("the onboarding's counts", () => {
  it("nothing is sent without consent to usage statistics", async () => {
    resetConsent();
    openOnboarding(); moveOnboarding(1); endOnboarding("skipped");
    setAnalyticsConsent(false);
    resetOnboarding();
    openOnboarding(); moveOnboarding(1); endOnboarding("finished");
    expect(sent).toEqual([]);
  });

  it("with consent: shown, each step reached once, then how it ended", async () => {
    setAnalyticsConsent(true);
    openOnboarding();
    moveOnboarding(1); moveOnboarding(0); moveOnboarding(1); // Back and Next again: step 2 counts once
    moveOnboarding(2, 4215); moveOnboarding(3);
    endOnboarding("finished");
    expect(sent.every((u) => u === "/api/collect/onboarding")).toBe(true);
    const b = await read();
    expect(b.map((x) => [x.e, x.step, x.team])).toEqual([
      ["shown", 1, false], ["reached", 2, false], ["reached", 3, false], ["reached", 4, false], ["finished", 4, true],
    ]);
    // Never which team: only that one was picked.
    expect(JSON.stringify(b)).not.toContain("4215");
  });

  it("a skip says on which step", async () => {
    setAnalyticsConsent(true);
    openOnboarding(); moveOnboarding(1);
    endOnboarding("skipped");
    const b = await read();
    expect(b.at(-1)).toMatchObject({ e: "skipped", step: 2 });
  });

  it("a replay from Settings isn't counted", () => {
    setAnalyticsConsent(true);
    openOnboarding(true); moveOnboarding(1); endOnboarding("skipped");
    expect(sent).toEqual([]);
  });
});
