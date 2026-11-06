// @vitest-environment jsdom
// A search's follow-ups: People also ask (one closed row per question, 44 px tall at least, opening to its answer's
// line and a link running it), Related searches (one 44 px chip each, one per line on a phone) and the team's
// highlights link; nothing at all with none, before the answer is on screen, or with another search's.
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { SearchFollowUps } from "../../../shared/api";
import { prime } from "../../../lib/api";
import { FollowUpsRail, PeopleAlsoAsk, RelatedSearches, useFollowUps } from "./FollowUps";
import { TEAM_TEXT } from "./answerCells";
import { SEARCH_PALETTE } from "../../../lib/textTones";

afterEach(cleanup);
const f: SearchFollowUps = {
  ask: [
    { q: "What is 4215's record?", family: "team", preview: "26-6-0 · 81% win rate in 32 matches in 2025–26", value: "26-6-0", rest: "81% win rate in 32 matches in 2025–26", tone: { stat: { intent: "record", family: "stat", teams: [4215] } } },
    { q: "What events are coming up?", family: "events", preview: "988 events · Upcoming events", value: "988 events", rest: "Upcoming events", tone: { count: true } },
  ],
  related: [
    { q: "4215 win rate", family: "team", preview: "81% · 26 wins out of 32 matches in 2025–26", value: "81%", rest: "26 wins out of 32 matches in 2025–26", tone: { stat: { intent: "win-percent", family: "stat", teams: [4215] } } },
    { q: "4215 best alliance partner", family: "team", preview: "207 Critical Mass · 6-0-0 together in 6 matches", value: "207 Critical Mass", rest: "6-0-0 together in 6 matches", tone: { stat: { intent: "best-partner", family: "stat", teams: [4215] } } },
  ],
  highlights: { q: "4215 highlights", family: "team", preview: "237 points · Best score: M2", value: "237 points", rest: "Best score: M2", tone: { stat: { intent: "team-highlights", family: "stat", teams: [4215] } }, team: 4215 },
};
const draw = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>).container;
const href = (q: string) => `/search?q=${encodeURIComponent(q)}`;

describe("people also ask", () => {
  it("lists each question closed, and opens to its line and a link that runs it", () => {
    const c = draw(<PeopleAlsoAsk ask={f.ask} />);
    const rows = [...c.querySelectorAll("details")];
    expect(rows.map((d) => d.querySelector("summary")?.textContent)).toEqual(f.ask.map((x) => x.q));
    expect(rows.every((d) => !d.open)).toBe(true);
    expect(c.querySelector("summary")!.className).toContain("min-h-[44px]");
    fireEvent.click(c.querySelector("summary")!);
    expect(rows[0].open).toBe(true);
    expect(rows[0].querySelector("[data-preview]")?.textContent).toBe(f.ask[0].preview);
    // The number in its answer card's colour: a one-team card's in the team's hue, a count in Count's amber.
    expect(rows[0].querySelector("[data-value]")!.className).toContain(TEAM_TEXT.split(" ")[0]);
    expect(rows[1].querySelector("[data-value]")!.className).toContain(SEARCH_PALETTE.count.text.split(" ")[0]);
    const link = rows[0].querySelector("a")!;
    expect(link.getAttribute("href")).toBe(href(f.ask[0].q));
    expect(link.className).toContain("min-h-[44px]");
  });
});

describe("related searches", () => {
  it("is one 44 px chip per search, each running it, one per line on a phone", () => {
    const c = draw(<RelatedSearches related={f.related} />);
    const links = [...c.querySelectorAll("a")];
    expect(links.map((a) => a.textContent)).toEqual(f.related.map((x) => x.q));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(f.related.map((x) => href(x.q)));
    expect(links.every((a) => a.className.includes("min-h-[44px]"))).toBe(true);
    expect(c.querySelector("ul")!.className).toContain("max-sm:flex-col");
  });
});

describe("the column beside the answer", () => {
  it("has the team's highlights, then People also ask, then Related searches", () => {
    const c = draw(<FollowUpsRail f={f} />);
    expect([...c.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"))).toEqual(["team-highlights", "people-also-ask", "related-searches"]);
    expect(c.querySelector("[data-block=team-highlights]")!.getAttribute("href")).toBe(href("4215 highlights"));
  });

  it("draws nothing with nothing to offer", () => {
    expect(draw(<FollowUpsRail f={{ ask: [], related: [] }} />).innerHTML).toBe("");
  });
});

describe("useFollowUps", () => {
  it("is none before the answer is on screen, and never another search's", () => {
    prime("/api/search/follow?q=4215+opr", { q: "4215 opr", ...f });
    expect(renderHook(() => useFollowUps("4215 opr", undefined, true)).result.current.ask).toEqual(f.ask);
    expect(renderHook(() => useFollowUps("4215 opr", undefined, false)).result.current.ask).toEqual([]);
    prime("/api/search/follow?q=4215+record", { q: "4215 opr", ...f });
    expect(renderHook(() => useFollowUps("4215 record", undefined, true)).result.current.ask).toEqual([]);
  });
});
