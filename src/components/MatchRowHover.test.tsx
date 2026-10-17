// @vitest-environment jsdom
// Scrolling a long match list under a resting pointer: rows sliding under it must not light up one after
// another (each one repaints the list). So every hover style in a match row waits for the page to be still
// (the still-hover variants, keyed off html[data-scroll-idle]), and the row's own fade is background-only.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";

vi.mock("../lib/meta", () => ({ usePredictable: () => true }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
vi.mock("./MatchVideo", () => ({ useVideoLinkCount: () => 0 }));

const { MatchList } = await import("./predict");
const { TooltipProvider } = await import("./ui/overlay");

const side = (ts: number[], total: number) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: { total, np: total, auto: 10, teleop: 20, endgame: 10, pen: 0 } });
const match = (n: number): MatchView => ({
  season: 2025, code: "HOVQ1", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: true,
  red: side([11, 12], 100), blue: side([13, 14], 90), video: "https://www.youtube.com/watch?v=x",
  prediction: { pRed: 0.6, redMean: 100, blueMean: 95, tier: "provisional", kind: "live", predictedAt: null, factors: [] } as unknown as MatchView["prediction"],
});
afterEach(cleanup);

it("has no hover style in a match row that would fire while the page scrolls", () => {
  const { container } = render(<MemoryRouter><TooltipProvider><MatchList matches={[match(1), match(2)]} highlight={11} /></TooltipProvider></MemoryRouter>);
  const rows = [...container.querySelectorAll<HTMLElement>("[data-match]")];
  expect(rows).toHaveLength(2);
  const classes = rows.flatMap((r) => [r, ...r.querySelectorAll<HTMLElement>("*")]).flatMap((e) => (e.getAttribute("class") ?? "").split(/\s+/));
  // Plain `hover:` / `group-hover:` (lit while scrolling) is gone; the still-hover forms are there.
  expect(classes.filter((c) => /^(group-)?hover:|^group-hover\//.test(c))).toEqual([]);
  expect(classes.some((c) => c.startsWith("still-hover:bg-"))).toBe(true);
  expect(classes.some((c) => c.startsWith("row-still-hover:"))).toBe(true);
  // The row's own transition is the background alone (not colours, shadows or filters).
  const row = rows[0].querySelector<HTMLElement>(".group\\/row")!;
  expect(row.className).toContain("transition-[background-color]");
  expect(row.className).not.toMatch(/(^|\s)transition(-colors|-all)?(\s|$)/);
});

it("keys the still-hover variants off a present attribute on <html>, the form that restyles only what uses them", () => {
  const css = readFileSync(join(process.cwd(), "src", "index.css"), "utf8");
  const variant = (name: string) => css.match(new RegExp(`@custom-variant ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";
  expect(variant("still-hover")).toContain(":where(html[data-scroll-idle]) &:hover");
  expect(variant("row-still-hover")).toContain(":where(html[data-scroll-idle]) :where(.group\\/row):hover &");
  // A :not() form (`:not([data-scrolling] *)`) made every flip restyle the whole page (7 s of restyling over one test scroll of a big event).
  expect(variant("still-hover") + variant("row-still-hover")).not.toContain(":not(");
});
