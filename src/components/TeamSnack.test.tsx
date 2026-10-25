// @vitest-environment jsdom
// A tap on a team in a match list opens its card at the bottom instead of leaving for the team page: the name
// shows under every number, the card gives the team's place, record and OPR, and it marks the team in every row.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView, TeamProfile } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));
const profile = {
  team: { number: 207, name: "Critical Mass" },
  stats: { record: { wins: 3, losses: 0, ties: 0, matches: 3, events: 1 }, opr: { np: { value: 13.56, rank: 9, of: 100 } }, avg: { np: 41.33 }, rating: null },
  events: [{ season: 2026, code: "NJQ1", rank: 3 }],
} as unknown as TeamProfile;
vi.mock("../lib/api", () => ({ qs: () => "", useApi: () => ({ data: profile, error: null, reload() {} }) }));

const { MatchList, MatchRow } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const NAMES: Record<number, string> = { 207: "Critical Mass", 13048: "Absolute Zero", 4890: "AArcHive", 31586: "County Prep Radicals", 251: "Red Raiders" };
const side = (ts: number[], total: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true, ...(NAMES[number] ? { name: NAMES[number] } : {}) })), score: { total, np: total, auto: 0, teleop: total, endgame: 0, pen: 0 } });
const match = (n: number, red: number[], blue: number[], r: number, b: number): MatchView => ({
  season: 2026, code: "NJQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: true,
  red: side(red, r), blue: side(blue, b), video: null, prediction: null,
});
const matches = [match(1, [207, 13048], [4890, 31586], 57, 22), match(2, [251, 4890], [207, 31586], 20, 30)];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const list = () => render(<MemoryRouter><TooltipProvider><MatchList matches={matches} /></TooltipProvider></MemoryRouter>);
const chips = (n: number) => screen.getAllByRole("button", { name: new RegExp(`^${n} .*show team card`) });

it("shows each team's name under its number", () => {
  list();
  expect(document.querySelectorAll("[data-team-name]")).toHaveLength(8);
  expect(chips(207)[0].textContent).toContain("Critical Mass");
});

it("a tap opens the team's card instead of leaving the page, and marks the team in every row", () => {
  list();
  fireEvent.click(chips(207)[0]);
  const card = screen.getByRole("dialog", { name: "Team 207" });
  expect(card.textContent).toContain("Critical Mass");
  // Its place at this event, its record in these matches (won both), its season numbers.
  const facts = card.querySelector("[data-snack-facts]")!.textContent!;
  expect(facts).toContain("3rd place");
  expect(facts).toContain("2-0-0 W-L-T");
  expect(facts).toContain("13.56 npOPR");
  expect(facts).toContain("41.33 npAVG");
  expect(screen.getByRole("link", { name: /View team/ }).getAttribute("href")).toBe("/teams/207");
  for (const c of chips(207)) expect(c.getAttribute("aria-pressed")).toBe("true");
  expect(chips(4890)[0].getAttribute("aria-pressed")).toBe("false");
});

it("a second tap on the team, the X, or Escape closes the card", () => {
  list();
  fireEvent.click(chips(207)[0]);
  fireEvent.click(chips(207)[1]);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(chips(207)[0]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(chips(207)[0]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("a tap on another team swaps the card", () => {
  list();
  fireEvent.click(chips(207)[0]);
  fireEvent.click(chips(4890)[0]);
  expect(screen.getByRole("dialog", { name: "Team 4890" })).toBeTruthy();
});

it("a row outside a match list keeps the team link", () => {
  render(<MemoryRouter><TooltipProvider><MatchRow m={matches[0]} /></TooltipProvider></MemoryRouter>);
  expect(screen.getByRole("link", { name: /207/ }).getAttribute("href")).toBe("/teams/207?season=2026");
});
