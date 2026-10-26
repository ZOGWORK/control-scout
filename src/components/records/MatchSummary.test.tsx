// @vitest-environment jsdom
// /matches on a phone (audit E2): a summary card per match (the match, both alliances with every team its own
// link, the score, who won, the result against the prediction, a Report action), the picked columns behind
// "More stats", and a "Detailed table" toggle that brings the table (and its top scrollbar) back. Sorting,
// paging and export keep working, and the context survives opening a report and coming back.
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import type { MatchRecordRow } from "../../shared/statCatalog";

const asked: string[] = [];
const row = (n: number, red: number[], blue: number[], stats: MatchRecordRow["stats"], predictionTier: MatchRecordRow["predictionTier"] = null): MatchRecordRow => ({
  season: 2025, eventCode: "USMNCMP", eventName: "Minnesota State Championship", eventType: "Championship", eventStart: "2026-03-01",
  key: `qual:0:${n}`, level: "qual", label: `Q${n}`, time: "2026-03-01T15:00:00Z", red, blue, stats, predictionTier,
});
const ROWS: MatchRecordRow[] = [
  row(1, [9415, 16917], [4650, 18535], { redTotalPoints: 120, blueTotalPoints: 100, redPredictedWinPct: 70, highScore: 120, winningMargin: 20 }, "confident"),
  row(2, [7172, 23778], [20313, 21235], { redTotalPoints: 80, blueTotalPoints: 95, redPredictedWinPct: 64, highScore: 95, winningMargin: 15 }, "provisional"),
  row(3, [1, 2], [3, 4], { redTotalPoints: 50, blueTotalPoints: 50, redPredictedWinPct: null, highScore: 50, winningMargin: 0 }),
  // A replayed call the ledger has no tier for: the verdict stays, the percentage doesn't.
  row(4, [5, 6], [7, 8], { redTotalPoints: 90, blueTotalPoints: 60, redPredictedWinPct: 81, highScore: 90, winningMargin: 30 }, null),
];
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  useApi: (path: string | null) => {
    const records = !!path && /^\/api\/records\/\d+\/matches\?/.test(path);
    if (records) asked.push(path!);
    return { data: records ? { rows: ROWS, total: 160, page: Number(new URL(path!, "http://x").searchParams.get("page")), pageSize: 50 } : undefined, error: undefined, loading: false, reload: () => {} };
  },
  apiFetch: () => new Promise(() => {}),
}));

const { RecordsTable } = await import("./RecordsTable");
const { TooltipProvider } = await import("../ui/overlay");
const { usePageScroll } = await import("../../lib/pageScroll");

let search = "";
let nav: NavigateFunction;
function Probe() { search = useLocation().search; nav = useNavigate(); return null; }
const COLS = ["highScore", "winningMargin", "redPredictedWinPct"];
// The shell's page: its scroll restoration (usePageScroll) around the routes, like Shell.tsx.
function Page() {
  const main = useRef<HTMLElement>(null);
  usePageScroll(main);
  return (
    <main ref={main}>
      <Routes>
        <Route path="/matches" element={<RecordsTable scope="match" season={2025} predictable defaultCols={COLS} defaultSort="highScore" storageKey="matches" noun="matches" />} />
        <Route path="/events/:season/:code/match/:key" element={<p>The match report</p>} />
        <Route path="/teams/:n" element={<p>A team page</p>} />
      </Routes>
    </main>
  );
}
const mount = (url: string) => render(<MemoryRouter initialEntries={[url]}><TooltipProvider><Page /><Probe /></TooltipProvider></MemoryRouter>);
const lastParam = (k: string) => new URL(asked.at(-1)!, "http://x").searchParams.get(k);
const cards = () => within(screen.getByRole("list", { name: "Matches" })).getAllByRole("article");
const card = (label: string) => screen.getByRole("article", { name: new RegExp(`^${label},`) });

let phone = true;
// The page scrolls the document: a scroller that keeps what it's given, up to its content.
const doc = document.documentElement;
let top = 0;
beforeEach(() => {
  asked.length = 0; phone = true; top = 0;
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width: 639px") ? phone : false, media: query, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(doc, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = Math.max(0, Math.min(v, 4000)); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (doc as { scrollTop?: number }).scrollTop; });

/** Each heading that's more than one level below the one before it (axe's heading-order). */
const headingSkips = () => {
  const out: string[] = [];
  let prev = 0;
  for (const h of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const level = Number(h.tagName[1]);
    if (prev && level > prev + 1) out.push(`h${prev} → ${h.tagName.toLowerCase()} "${h.textContent}"`);
    prev = level;
  }
  return out;
};

describe("match records on a phone", () => {
  it("the cards' headings sit under a Matches section heading, never straight under the page's h1 (V4-A11Y-001)", () => {
    render(<MemoryRouter initialEntries={["/matches?season=2025"]}><TooltipProvider><h1>Match records</h1><Page /></TooltipProvider></MemoryRouter>);
    expect(cards()).toHaveLength(4);
    expect(screen.getByRole("heading", { level: 2, name: "Matches" })).toBeTruthy();
    expect(headingSkips()).toEqual([]);
  });

  it("shows a summary card per match instead of the table", () => {
    mount("/matches?season=2025");
    expect(screen.queryByRole("table")).toBeNull();
    expect(cards()).toHaveLength(4);
    const q1 = card("Q1");
    expect(q1.textContent).toContain("Minnesota State Championship");
    expect(q1.textContent).toContain("Red won by 20");
    // The result against the prediction, said outright.
    expect(q1.textContent).toContain("Called it");
    expect(q1.textContent).toContain("Red favoured (70%), Red won");
    expect(card("Q2").textContent).toContain("Upset");
    expect(card("Q2").textContent).toContain("Red favoured (64%), Blue won");
    expect(card("Q3").textContent).toContain("Tie, 50–50");
    expect(within(q1).getByRole("link", { name: /^Report/ }).getAttribute("href")).toBe("/events/2025/USMNCMP/match/qual%3A0%3A1");
    // The scores and the prediction are always fetched; the export keeps to the picked columns.
    expect(lastParam("fields")!.split(",")).toEqual(expect.arrayContaining(["highScore", "winningMargin", "redTotalPoints", "blueTotalPoints", "redPredictedWinPct"]));
    const csv = new URL(screen.getByRole("link", { name: /Export CSV/ }).getAttribute("href")!, "http://x");
    expect(csv.searchParams.get("fields")).toBe("highScore,winningMargin,redPredictedWinPct");
  });

  it("shows each call's recorded confidence tier beside its percentage, on the card and under More stats (audit PUB3-F03)", () => {
    mount("/matches?season=2025");
    const q1 = card("Q1"), q2 = card("Q2");
    // The tier is the one the server sent (Q1's 70% is confident, Q2's 64% provisional), never worked out from the %.
    expect(within(q1).getByText("solid").closest("span")!.textContent).toBe("confidence: solid");
    expect(q1.textContent).toMatch(/Red favoured \(70%\), Red wonconfidence: solid\(replayed call\)/);
    expect(within(q2).getByText("rough guess").closest("span")!.textContent).toBe("confidence: rough guess");
    expect(within(q2).queryByText("solid")).toBeNull();
    fireEvent.click(within(q1).getByRole("button", { name: /More stats/ }));
    const dd = within(q1).getByText("Red pred. win %").nextElementSibling!;
    expect(dd.textContent).toBe("70%confidence: solid");
    // No prediction at all: no verdict, no tier.
    expect(card("Q3").textContent).not.toMatch(/favoured|confidence/);
  });

  it("shows a call with no recorded tier without its percentage, on the card and under More stats", () => {
    mount("/matches?season=2025");
    const q4 = card("Q4");
    expect(q4.textContent).toContain("Called it");
    expect(q4.textContent).toContain("Red favoured, Red won");
    expect(q4.textContent).not.toContain("81%");
    expect(q4.textContent).not.toMatch(/rough guess|fair|solid/);
    fireEvent.click(within(q4).getByRole("button", { name: /More stats/ }));
    const dd = within(q4).getByText("Red pred. win %").nextElementSibling!;
    expect(dd.textContent).not.toContain("%");
    expect(dd.textContent).toContain("Not shown: no confidence tier was recorded with this call");
  });

  it("keeps every team its own link, in its alliance", () => {
    mount("/matches?season=2025");
    const red = within(card("Q1")).getByRole("list", { name: "Red alliance" });
    const blue = within(card("Q1")).getByRole("list", { name: "Blue alliance" });
    expect(within(red).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/teams/9415?season=2025", "/teams/16917?season=2025"]);
    expect(within(blue).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/teams/4650?season=2025", "/teams/18535?season=2025"]);
    fireEvent.click(within(blue).getByRole("link", { name: "Team 18535" }));
    expect(screen.getByText("A team page")).toBeTruthy();
  });

  it("opens the picked columns under a card, and closes them again", () => {
    mount("/matches?season=2025");
    const more = within(card("Q1")).getByRole("button", { name: /More stats/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const details = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(details.hidden).toBe(true);
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(details.hidden).toBe(false);
    expect(within(details).getByText("Margin").nextElementSibling!.textContent).toBe("20");
    // Only that card opened.
    expect(within(card("Q2")).getByRole("button", { name: /More stats/ }).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("switches to the detailed table (with its top scrollbar) and remembers the choice", () => {
    mount("/matches?season=2025");
    const toggle = screen.getByRole("group", { name: "Layout" });
    fireEvent.click(within(toggle).getByRole("button", { name: "Detailed table" }));
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Matches" })).toBeNull();
    expect(document.querySelector("[data-records-topbar]")).not.toBeNull();
    expect(within(toggle).getByRole("button", { name: "Detailed table" }).getAttribute("aria-pressed")).toBe("true");
    // Sorting by a column header still works there.
    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: /Margin/ }));
    expect(lastParam("sort")).toBe("winningMargin");
    cleanup();
    mount("/matches?season=2025");
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Layout" })).getByRole("button", { name: "Summary" }));
    expect(cards()).toHaveLength(4);
  });

  it("sorts and pages from the summary", () => {
    mount("/matches?season=2025&page=2");
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "winningMargin" } });
    expect(search).toBe("?season=2025&sort=winningMargin");
    expect(lastParam("sort")).toBe("winningMargin");
    fireEvent.click(screen.getByRole("button", { name: /Sort direction: high to low/ }));
    expect(lastParam("dir")).toBe("asc");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(lastParam("page")).toBe("2");
    expect(lastParam("sort")).toBe("winningMargin");
  });

  it("comes back from a report to the same sort, filter, page, open cards and scroll", () => {
    mount("/matches?season=2025&sort=winningMargin&type=Championship&page=2");
    fireEvent.click(within(card("Q2")).getByRole("button", { name: /More stats/ }));
    act(() => { doc.scrollTop = 1800; window.dispatchEvent(new Event("scroll")); });
    fireEvent.click(within(card("Q2")).getByRole("link", { name: /^Report/ }));
    expect(screen.getByText("The match report")).toBeTruthy();
    expect(doc.scrollTop).toBe(0);
    act(() => nav(-1));
    expect(search).toBe("?season=2025&sort=winningMargin&type=Championship&page=2");
    expect([lastParam("sort"), lastParam("eventType"), lastParam("page")]).toEqual(["winningMargin", "Championship", "2"]);
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("winningMargin");
    expect(within(card("Q2")).getByRole("button", { name: /Fewer stats/ }).getAttribute("aria-expanded")).toBe("true");
    expect(within(card("Q1")).getByRole("button", { name: /More stats/ }).getAttribute("aria-expanded")).toBe("false");
    expect(doc.scrollTop).toBe(1800);
  });
});

describe("match records on a wider screen", () => {
  it("keeps the table, with no summary or layout toggle", () => {
    phone = false;
    mount("/matches?season=2025");
    expect(screen.getByRole("table")).toBeTruthy();
    // The predicted-win column carries each call's recorded tier, and no % where there is none.
    const cell = (label: string) => within(screen.getByRole("table")).getByText(label).closest("tr")!.lastElementChild!;
    expect(cell("Q1").textContent).toBe("70%confidence: solid");
    expect(cell("Q2").textContent).toBe("64%confidence: rough guess");
    expect(cell("Q4").textContent).not.toContain("%");
    expect(screen.queryByRole("list", { name: "Matches" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Layout" })).toBeNull();
  });
});
