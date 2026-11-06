// The chance printed once on a prediction card (the results guide, §7): its own headline and win tile go, nothing else.
import { describe, expect, it } from "vitest";
import type { StatAnswer } from "../../../src/shared/searchStat";
import { nextChance, once } from "./forecast";

const card = (headline: string): StatAnswer => ({
  family: "stat", intent: "x", title: "t", scope: [], definition: "", source: "", headline: { value: headline, label: "to win the event", sub: "Mar 8 · 2,000 runs" },
  blocks: [
    { kind: "chance", p: 0, who: "12345", label: "to win the event, before it starts" },
    { kind: "kpis", items: [{ label: "Win the event", value: "0%" }, { label: "Make the playoffs", value: "0%" }, { label: "Advance", value: "No" }] },
  ],
});

describe("once", () => {
  it("drops the headline and the win tile of the same figure, keeps every other measure", () => {
    const a = once(card("0%"));
    expect(a.headline).toBeUndefined();
    expect(a.blocks[0]).toMatchObject({ kind: "chance", note: "Mar 8 · 2,000 runs" });
    const tiles = a.blocks[1].kind === "kpis" ? a.blocks[1].items.map((i) => i.label) : [];
    expect(tiles).toEqual(["Make the playoffs", "Advance"]);
  });
  it("a bar of the chance to advance drops the Advance tile of the same figure, and keeps the win tile", () => {
    const a = once({ ...card("33%"), blocks: [
      { kind: "chance", p: 0.33, who: "12345", label: "to advance, before it starts" },
      { kind: "kpis", items: [{ label: "Win the event", value: "33%" }, { label: "Advance", value: "33%" }] },
    ] });
    expect(a.blocks[1].kind === "kpis" ? a.blocks[1].items.map((i) => i.label) : []).toEqual(["Win the event"]);
  });
  it("a headline of another figure stays", () => {
    expect(once(card("5.7 → 7 wins")).headline?.value).toBe("5.7 → 7 wins");
  });
});

describe("the next match's chance", () => {
  it("is one call's: the engine's now with its own scores, else the saved chance alone", () => {
    const now = nextChance(0.7, { p: 0.62, note: "Predicted 150 ±20 – 130 ±18, with its 80% ranges" }, "to win the next match (Q12)", "12345");
    expect(now).toMatchObject({ p: 0.62, label: "to win the next match (Q12), as the engine calls it now", note: expect.stringContaining("150 ±20") });
    const saved = nextChance(0.7, null, "to win the next match (Q12)", "12345");
    expect(saved).toMatchObject({ p: 0.7, label: "to win the next match (Q12), before it's played" });
    expect(saved).not.toHaveProperty("note");
  });
});
