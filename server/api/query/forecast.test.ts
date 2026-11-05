// The chance printed once on a prediction card (the results guide, §7): its own headline and win tile go, nothing else.
import { describe, expect, it } from "vitest";
import type { StatAnswer } from "../../../src/shared/searchStat";
import { once } from "./forecast";

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
  it("a headline of another figure stays", () => {
    expect(once(card("5.7 → 7 wins")).headline?.value).toBe("5.7 → 7 wins");
  });
});
