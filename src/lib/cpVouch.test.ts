// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearVouch, noteVouch, vouchPending } from "./cpVouch";

describe("continuing to Control Point after signing in here", () => {
  beforeEach(() => sessionStorage.clear());

  it("the URL marks it, and it's remembered for this tab (Google's sign-in comes back to another page)", () => {
    expect(vouchPending("?section=profile")).toBe(false);
    expect(vouchPending("?section=profile&for=control-point")).toBe(true);
    noteVouch("?section=profile&for=control-point", 1_000);
    expect(vouchPending("?signin=ok", 1_000 + 60_000)).toBe(true);
  });

  it("never outlives the server's 10-minute state cookie, and clears once followed", () => {
    noteVouch("?for=control-point", 1_000);
    expect(vouchPending("", 1_000 + 10 * 60_000)).toBe(false);
    noteVouch("?for=control-point", 5_000);
    clearVouch();
    expect(vouchPending("", 6_000)).toBe(false);
  });

  it("other pages don't start one", () => {
    noteVouch("?for=something-else");
    noteVouch("");
    expect(vouchPending("")).toBe(false);
  });
});
