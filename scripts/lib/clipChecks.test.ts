import { describe, expect, it } from "vitest";
import { NO_OVERLAY_AT_START, noOverlay, openingVerdict } from "./clipChecks";
import { overlayDivision, overlayLabel } from "./videoFrames";

// A read as the reader makes it from a frame's text (scripts/video-frames.ts readAtOnce, label only).
const read = (text: string, own?: string, others: string[] = []) => {
  const division = own ? overlayDivision(text, own, others) : undefined;
  return { label: division === "other" ? null : overlayLabel(text), division };
};

describe("a clock clip's first frame", () => {
  it("keeps a clip whose first frame names its match", () => {
    expect(openingVerdict("Q21", [read("FIRST AGE  Qualification 21 of 36  2:05")])).toEqual({ state: "ok" });
  });

  it("pulls one whose first frame names another match, and says which", () => {
    expect(openingVerdict("Q22", [read("FIRST AGE  Qualification 21 of 36  2:05")])).toEqual({ state: "pulled", showed: "Q21" });
  });

  it("pulls one opening on another division's match on a shared stream (ROCMPCND's Friday stream, VLAICU at 9761 s)", () => {
    const r = read("Romania Championship - VLAICU Divis  Qualification 1 of 72  2:23", "COANDA", ["VLAICU"]);
    expect(openingVerdict("Q1", [r])).toEqual({ state: "pulled", showed: "another division's match" });
    expect(openingVerdict("Q2", [read("Romania Championship - COANDĂ Divisi  Qualification 2 of 72", "COANDA", ["VLAICU"])])).toEqual({ state: "ok" });
  });

  it("never pulls on a frame that names nothing: a later read stands in for it, else it's unconfirmed", () => {
    expect(openingVerdict("Q21", [read(""), read("FIRST AGE  Qualification 21 of 36  2:05")])).toEqual({ state: "ok" });
    expect(openingVerdict("Q21", [read(""), read("  "), read("FIRST AGE")])).toEqual({ state: "unconfirmed", why: NO_OVERLAY_AT_START });
  });

  it("counts a video as unreadable only when enough clips were read and none named any match", () => {
    const u = { state: "unconfirmed" as const, why: NO_OVERLAY_AT_START };
    expect(noOverlay([u, u, u])).toBe(true);
    expect(noOverlay([u, u])).toBe(false);
    expect(noOverlay([u, u, { state: "ok" }])).toBe(false);
  });
});
