// @vitest-environment jsdom
// Issue #2014 ("Missing color"): the v8 team card's fact tiles each in their own soft colour, as the classic KPI
// tiles were (answerCells kpiSwatches): the record's wins green, OPR purple, the rank slate blue, the best score
// orange; a thin bracket and the number's words in it, no fill. The last match's score in its result's tint.
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MatchView } from "../../../shared/api";
import type { StatAnswer } from "../../../shared/searchStat";
import type { SeasonSummary } from "./ResultCards";
import { V8_SOFT } from "./v8tone";

const state = vi.hoisted(() => ({ matches: [] as unknown[] }));
vi.mock("../../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../../lib/api")>()), useApi: () => ({ data: { matches: state.matches }, error: null, loading: false }) }));
const { V8TeamAnswer, TEAM_FACT_COLOUR } = await import("./V8Results");

const summary = { season: 2026, s: { team: 26000, record: "16-5-0", opr: 98, oprRank: 39, of: 3271 } } as unknown as SeasonSummary;
const stat = { intent: "team-highlights", headline: { value: "188 points", label: "Best score" }, blocks: [] } as unknown as StatAnswer;
const side = (n: number, total: number) => ({ teams: [{ number: n }], score: { total } });
const match = (own: number, opp: number) => ({ season: 2026, code: "AUBRQ1", key: "qual:0:7", label: "M7", played: true, time: null, startsAt: null, red: side(26000, own), blue: side(1, opp) }) as unknown as MatchView;
const show = () => render(<MemoryRouter><V8TeamAnswer team={26000} name="Theseus" summary={summary} stat={stat} /></MemoryRouter>);

afterEach(() => { cleanup(); state.matches = []; });

describe("V8TeamAnswer fact tiles (issue #2014)", () => {
  it("gives each tile its own soft colour: a bracket on the tile and the colour on its number", () => {
    const { container } = show();
    const tiles = [...container.querySelectorAll<HTMLElement>("[data-team-facts] [data-fact]")];
    expect(tiles.map((t) => t.dataset.fact)).toEqual(["Record", "OPR", "OPR rank", "Best score"]);
    expect(tiles.map((t) => t.dataset.colour)).toEqual(["green", "purple", "accent", "orange"]);
    expect(new Set(Object.values(TEAM_FACT_COLOUR)).size).toBe(Object.keys(TEAM_FACT_COLOUR).length);
    for (const t of tiles) {
      const c = V8_SOFT[t.dataset.colour as keyof typeof V8_SOFT];
      expect(t.className).toContain("v8:border-l-2");
      expect(t.className).toContain(c.edge);
      expect(t.querySelector("dd")!.className).toContain(c.text);
      expect(t.className).not.toMatch(/\bbg-/); // a bracket and words, never a filled block
    }
    // The record's wins in green, its losses and ties stay muted.
    expect(tiles[0].querySelector("[data-record-text] b")!.className).toContain(V8_SOFT.green.text);
  });

  it("tints the last match's own score by its result", () => {
    state.matches = [match(181, 56)];
    let { container } = show();
    let score = container.querySelector<HTMLElement>("[data-last-result]")!;
    expect(score.dataset.lastResult).toBe("won");
    expect(score.textContent).toBe("181–56");
    expect(score.querySelector("span")!.className).toContain(V8_SOFT.green.text);
    cleanup();
    state.matches = [match(50, 90)];
    ({ container } = show());
    score = container.querySelector<HTMLElement>("[data-last-result]")!;
    expect(score.dataset.lastResult).toBe("lost");
    expect(score.querySelector("span")!.className).toContain(V8_SOFT.red.text);
  });
});
