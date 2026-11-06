// @vitest-environment jsdom
// People also ask: one closed row per question (44 px tall at least), its answer's line and a link running the
// question once opened; nothing at all with no questions, or with another search's.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchFollowUp } from "../../../shared/api";
import { prime } from "../../../lib/api";
import { PeopleAlsoAsk } from "./PeopleAlsoAsk";

afterEach(cleanup);
const ask: SearchFollowUp[] = [
  { q: "What is 4215's record?", family: "team", preview: "26-6-0 · 81% win rate in 32 matches in 2025–26" },
  { q: "What awards has 4215 won?", family: "awards", preview: "11 awards · 7 performance · 4 judged" },
];
const draw = (q: string, ready = true) => render(<MemoryRouter><PeopleAlsoAsk q={q} ready={ready} /></MemoryRouter>).container;

describe("people also ask", () => {
  it("lists each question closed, and opens to its line and a link that runs it", () => {
    prime("/api/search/follow?q=4215+opr", { q: "4215 opr", ask });
    const c = draw("4215 opr");
    const rows = [...c.querySelectorAll("details")];
    expect(rows.map((d) => d.querySelector("summary")?.textContent)).toEqual(ask.map((x) => x.q));
    expect(rows.every((d) => !d.open)).toBe(true);
    expect(c.querySelector("summary")!.className).toContain("min-h-[44px]");
    fireEvent.click(c.querySelector("summary")!);
    expect(rows[0].open).toBe(true);
    expect(rows[0].querySelector("[data-preview]")?.textContent).toBe(ask[0].preview);
    const link = rows[0].querySelector("a")!;
    expect(link.getAttribute("href")).toBe(`/search?q=${encodeURIComponent(ask[0].q)}`);
    expect(link.className).toContain("min-h-[44px]");
  });

  it("draws nothing with no questions, before the answer is on screen, or for another search", () => {
    prime("/api/search/follow?q=nothing", { q: "nothing", ask: [] });
    expect(draw("nothing").innerHTML).toBe("");
    cleanup();
    prime("/api/search/follow?q=4215+record", { q: "4215 opr", ask });
    expect(draw("4215 record").innerHTML).toBe("");
    cleanup();
    expect(draw("4215 opr", false).innerHTML).toBe("");
  });
});
