// @vitest-environment jsdom
// A match row links each team to its page, except a team that has none (src/shared/teamPages.ts): FIRST's
// "Off-Season Demo Team" placeholder and its 7-digit stand-in numbers still show in the row, as plain text.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: [number, string][], total: number) => ({ teams: ts.map(([number, name]) => ({ number, name, surrogate: false, dq: false, onField: true })), score: { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const match: MatchView = {
  season: 2025, code: "OFFS", key: "qual:0:1", level: "qual", series: 0, number: 1, label: "Q1", time: null, startsAt: null, played: true,
  red: side([[4215, "Hypnotic Robotics"], [99999, "Off-Season Demo Team"]], 100), blue: side([[18360, "Zeta"], [202300005, "Ammon Brick Heads"]], 90), video: null,
  prediction: null,
} as unknown as MatchView;
afterEach(cleanup);

it("opens a card for real teams only; a placeholder or stand-in number stays in the row as plain text", () => {
  const { container } = render(<MemoryRouter><TooltipProvider><MatchList matches={[match]} /></TooltipProvider></MemoryRouter>);
  // In a match list a team chip opens the team card (TeamSnack), which links to the page.
  const cards = [...container.querySelectorAll("button[aria-label$='show team card']")].map((b) => b.getAttribute("aria-label")!.split(" ")[0]);
  expect(cards).toEqual(["4215", "18360"]);
  expect(container.querySelector("a[href^='/teams/99999'], a[href^='/teams/202300005']")).toBeNull();
  expect(container.textContent).toContain("99999");
  expect(container.textContent).toContain("202300005");
});
