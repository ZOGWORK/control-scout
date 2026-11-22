// @vitest-environment jsdom
// Enter on a query the search box's dropdown has already answered: /search starts from that answer (the handoff,
// src/components/search/handoff.ts), so the results are on screen from the first frame and the loading screen is
// never shown. The page's own request then replaces them (here it answers only when a test says so).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../shared/api";
import { handOffAnswer } from "../components/search/handoff";
import { markDirect } from "../components/search/direct";

const HIT: SearchHit = { kind: "team", ref: "6980", title: "6980 | Bad Wolf", subtitle: "Oradell, NJ, USA", season: 2026, match: "exact" };
const ANSWER: SearchAnswer = { q: "6980", hits: [HIT], pages: [], step: "deterministic", weak: false };
const TOP: SearchAnswer = {
  q: "top rookie teams", step: "deterministic", weak: false, pages: [],
  hits: [{ kind: "team", ref: "19666", title: "19666 | Forever Knight", subtitle: "Austin, TX, USA", season: 2026 }],
  understood: { kind: "names", label: "Top rookie teams" },
};
/** Another query, answered by a box: one team whose whole name it is, the page it names if the results page waits. */
const NEXT: SearchAnswer = { q: "bad wolf", step: "deterministic", weak: false, pages: [], hits: [HIT] };

// The page's own requests: each waits until a test answers it, so what's on screen is never its answer by accident.
const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })),
  useApi: () => ({ data: undefined, loading: false, error: null }),
}));
vi.mock("../lib/meta", async (orig) => ({ ...(await orig<typeof import("../lib/meta")>()), useMeta: () => null, useCurrentSeason: () => 2026 }));
vi.mock("../lib/flags", async (orig) => ({ ...(await orig<typeof import("../lib/flags")>()), useServerFlag: () => false }));
vi.mock("../lib/personal", async (orig) => ({
  ...(await orig<typeof import("../lib/personal")>()),
  usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }),
}));

const { default: SearchPage } = await import("./SearchPage");

afterEach(() => { cleanup(); pending.length = 0; });
const loading = () => document.querySelector("[data-search-loading]");
const answer = async (match: RegExp, body: unknown) => {
  const i = pending.findIndex((p) => match.test(p.url));
  expect(i, `a request for ${match}`).toBeGreaterThanOrEqual(0);
  const [p] = pending.splice(i, 1);
  await act(async () => { p.resolve(body); });
};

function Where() { const at = useLocation(); return <p data-testid="at">{at.pathname}{at.search}</p>; }
function Go({ to, label }: { to: string; label: string }) {
  const nav = useNavigate();
  return <button type="button" onClick={() => nav(to)}>{label}</button>;
}
const show = (url: string, extra?: React.ReactNode) =>
  render(<MemoryRouter initialEntries={[url]}><SearchPage />{extra}</MemoryRouter>);

describe("search results page, the answer Enter already had", () => {
  it("draws the handed-off answer at once: the results, never the loading screen", () => {
    handOffAnswer(ANSWER);
    show("/search?q=6980");
    expect(loading()).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Bad Wolf");
  });

  it("a submitted query keeps showing what the box handed over: Enter's mark never hides it behind the loading screen", () => {
    // The whole production path: the box answered these words, Enter marked the query for /search (a query whose
    // answer isn't in yet may name one page, src/components/search/direct.ts) and handed the answer over. The page's
    // own request is still out (the mock never answers): it draws the handoff, not the loading screen.
    markDirect("top rookie teams");
    handOffAnswer(TOP);
    show("/search?q=top%20rookie%20teams");
    expect(loading()).toBeNull();
    // The answer's page, drawn from the handoff: its title, and the team it found.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Top rookie teams");
    expect(screen.getAllByText(/Forever Knight/).length).toBeGreaterThan(0);
  });

  it("a query submitted here from the page's own box draws its answer too, and isn't sent on to the page it names", async () => {
    // This visit arrived by submitting a query (its answer on screen from the box's handoff).
    handOffAnswer(TOP);
    markDirect("top rookie teams");
    show("/search?q=top%20rookie%20teams", <><Where /><Go to="/search?q=bad%20wolf" label="submit here" /></>);
    expect(loading()).toBeNull();
    // The visitor types another query in the page's own box: its dropdown answers it, and Enter hands that answer over
    // as it submits the query (the page's `?q=` changes; the page itself doesn't remount).
    handOffAnswer(NEXT);
    markDirect("bad wolf");
    fireEvent.click(screen.getByRole("button", { name: "submit here" }));
    expect(screen.getByTestId("at").textContent).toBe("/search?q=bad%20wolf");
    // The box's answer, on screen from the first frame: no loading screen over it while the page asks.
    expect(loading()).toBeNull();
    expect(screen.getAllByText(/Bad Wolf/).length).toBeGreaterThan(0);
    // Answers: a team named whole would be a page (`/teams/6980`), but the box read these words before sending them
    // here and found none, so the page stays with what it drew.
    await answer(/q=bad%20wolf&/, ANSWER);
    expect(screen.getByTestId("at").textContent).toBe("/search?q=bad%20wolf");
    expect(loading()).toBeNull();
  });

  it("without a handed answer for these words, the same page still shows its loading screen while it asks", () => {
    handOffAnswer(ANSWER);
    show("/search?q=1234");
    expect(loading()).toBeTruthy();
    expect(screen.queryByText(/Bad Wolf/)).toBeNull();
  });

  it("a later query submitted here isn't seeded by the first one: it still goes on to the page its answer names", async () => {
    // This page stays mounted when `?q=` changes: the first query's handoff must not excuse later ones from the wait
    // that lets a submitted query open the one page it names (./components/search/direct.ts).
    handOffAnswer(TOP);
    markDirect("top rookie teams");
    show("/search?q=top%20rookie%20teams", <><Where /><Go to="/search?q=team%206980" label="search again" /></>);
    expect(loading()).toBeNull();
    // The bar's box answered the next query and marked it, as Enter does.
    markDirect("team 6980");
    fireEvent.click(screen.getByRole("button", { name: "search again" }));
    expect(screen.getByTestId("at").textContent).toBe("/search?q=team%206980");
    await answer(/q=team%206980&/, ANSWER);
    expect(screen.getByTestId("at").textContent).toBe("/teams/6980");
  });

  it("coming back to the first query isn't seeded either: only the visit that arrived with an answer is", async () => {
    // Seeded on /search?q=6980…
    handOffAnswer(ANSWER);
    markDirect("6980");
    show("/search?q=6980", <><Where /><Go to="/search?q=top%20rookie%20teams" label="another" /><Go to="/search?q=6980" label="first" /></>);
    expect(loading()).toBeNull();
    // …away to another query, which answers itself…
    fireEvent.click(screen.getByRole("button", { name: "another" }));
    await answer(/q=top%20rookie%20teams&/, TOP);
    pending.length = 0; // the first visit's request, left behind by this one
    // …and back to the first words, submitted again from the box: this visit has nothing in hand, so /search waits
    // for its own answer and goes on to the one page it names.
    markDirect("6980");
    fireEvent.click(screen.getByRole("button", { name: "first" }));
    await answer(/q=6980&/, ANSWER);
    expect(screen.getByTestId("at").textContent).toBe("/teams/6980");
  });
});
