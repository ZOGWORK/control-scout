// @vitest-environment jsdom
// Enter (and the magnifier) on a query that names one thing exactly goes straight to its page (brief Req 10, "digits
// → team page"): a team number, "team"/"ftc" + number, one team's whole name, an event code. Anything else opens
// /search. Decided from the server's answer for the query, the same one the dropdown shows. The answers below are
// shaped like the live API's (controlscout.org, 2026-11-02).
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHit } from "../../shared/api";

const team = (ref: string, name: string, extra: Partial<SearchHit> = {}): SearchHit => ({ kind: "team", ref, title: `${ref} | ${name}`, subtitle: "Oradell, NJ, USA", season: 2026, match: "exact", ...extra });
const one = (q: string, h: SearchHit, extra: Partial<SearchAnswer> = {}): SearchAnswer => ({ q, hits: [h], pages: [], step: "deterministic", weak: false, understood: { kind: "team", label: "Bad Wolf (6980)" }, ...extra });
const BAD_WOLF = team("6980", "Bad Wolf");

const pending: { url: string; resolve: (v: unknown) => void }[] = [];
vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof import("../../lib/api")>()), apiFetch: (url: string) => new Promise((resolve) => pending.push({ url, resolve })) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ state: { myTeam: null, tracked: { teams: [], events: [] }, bookmarks: [] } }) }));
vi.mock("../../lib/meta", async (orig) => ({ ...(await orig<typeof import("../../lib/meta")>()), useMeta: () => null }));
vi.mock("../../lib/flags", async (orig) => ({ ...(await orig<typeof import("../../lib/flags")>()), useServerFlag: () => false }));

const { SearchBox, SEARCH_DEBOUNCE_MS, hitHref } = await import("./SearchBox");
const { directHit } = await import("./direct");
const { RECENT_KEY } = await import("./discover");

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); Element.prototype.scrollIntoView = () => {}; localStorage.clear(); });
afterEach(() => { cleanup(); pending.length = 0; vi.useRealTimers(); localStorage.clear(); });

describe("what names one thing exactly (directHit)", () => {
  it("a team number, or team/ftc + number: the team", () => {
    for (const q of ["6980", "team 6980", "Team 6980", "ftc 6980", "#6980", " 6980 "]) expect(directHit(one(q, BAD_WOLF), q), q).toBe(BAD_WOLF);
  });
  it("one team's whole name, any case: the team", () => {
    expect(directHit(one("Bad Wolf", BAD_WOLF), "Bad Wolf")).toBe(BAD_WOLF);
    expect(directHit(one("bad  wolf", BAD_WOLF), "bad  wolf")).toBe(BAD_WOLF);
  });
  it("part of a name, a topic, a question, a Compare or two teams: not one thing", () => {
    expect(directHit(one("bad", BAD_WOLF), "bad")).toBeNull();
    expect(directHit(one("6980 record", { ...BAD_WOLF, section: "ranking" }), "6980 record")).toBeNull();
    expect(directHit(one("6980 opr", { ...BAD_WOLF, facts: [{ label: "OPR", value: "88.1" }] }), "6980 opr")).toBeNull();
    expect(directHit(one("when did 6980 go to worlds", BAD_WOLF, { card: { kind: "worlds", title: "Worlds appearances", lines: [] } }), "when did 6980 go to worlds")).toBeNull();
    expect(directHit(one("6980 vs 4215", { ...BAD_WOLF, href: "/compare?teams=6980,4215" }), "6980 vs 4215")).toBeNull();
    const two: SearchAnswer = { q: "ultraviolet", hits: [team("20245", "Ultraviolet"), team("23268", "Ultraviolet")], pages: [], step: "deterministic", weak: false, understood: { kind: "names", label: "x" } };
    expect(directHit(two, "ultraviolet")).toBeNull();
    expect(directHit(one("6981", BAD_WOLF), "6981")).toBeNull(); // the number typed isn't the team found
  });
  it("a correction or nothing found is never a shortcut", () => {
    expect(directHit(one("bad wolff", BAD_WOLF, { step: "did-you-mean", didYouMean: "bad wolf" }), "bad wolff")).toBeNull();
    expect(directHit({ q: "99999", hits: [], pages: [], step: "recovery", weak: true }, "99999")).toBeNull();
    expect(directHit(undefined, "6980")).toBeNull();
  });
  it("an event code: that event (the server's first, the current season's)", () => {
    const ev = (ref: string): SearchHit => ({ kind: "event", ref, title: "x", subtitle: "", season: 2026, match: "exact" });
    const a: SearchAnswer = { q: "USNJCMP", hits: [ev("2026:USNJCMP"), ev("2025:USNJCMPPKWY")], pages: [], step: "deterministic", weak: false };
    expect(directHit(a, "usnjcmp")?.ref).toBe("2026:USNJCMP");
    expect(directHit({ ...a, hits: [ev("2025:USNJCMPPKWY")] }, "usnjcmp")).toBeNull();
  });
});

describe("Enter and the magnifier on a search box", () => {
  function Where() { return <p data-testid="at">{useLocation().pathname}{useLocation().search}</p>; }
  function Box() { const nav = useNavigate(); return <SearchBox onPick={(h) => nav(hitHref(h))} placeholder="Search" label="Search" />; }
  function Back() { const nav = useNavigate(); return <button type="button" onClick={() => nav(-1)}>back</button>; }
  const mount = () => {
    render(<MemoryRouter initialEntries={["/events"]}><Box /><Routes><Route path="*" element={<><Where /><Back /></>} /></Routes></MemoryRouter>);
    const input = screen.getByRole("combobox", { name: "Search" }) as HTMLInputElement;
    act(() => input.focus());
    return input;
  };
  const answerWith = async (body: SearchAnswer) => { const [p] = pending.splice(0, 1); await act(async () => { p.resolve(body); }); };
  const at = () => screen.getByTestId("at").textContent;

  it("\"6980\": straight to the team's page in one press, before the typing pause is over; Back returns to where it was typed", async () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "6980" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(at()).toBe("/events"); // waits for the answer (asked at once)
    await answerWith(one("6980", BAD_WOLF));
    expect(at()).toBe("/teams/6980");
    expect(JSON.parse(localStorage.getItem(RECENT_KEY)!)).toEqual(["6980"]); // still a recent search
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(at()).toBe("/events");
  });
  it("\"team 6980\" and \"Bad Wolf\" (the answer already in): the team's page, by the magnifier too", async () => {
    const input = mount();
    for (const q of ["team 6980", "Bad Wolf"]) {
      act(() => input.focus());
      fireEvent.change(input, { target: { value: q } });
      await act(async () => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 5); });
      await answerWith(one(q, BAD_WOLF));
      fireEvent.click(screen.getByRole("button", { name: "Run search" }));
      expect(at()).toBe("/teams/6980");
    }
  });
  it("\"ultraviolet\" (two teams by that name): the results page", async () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "ultraviolet" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await answerWith({ q: "ultraviolet", hits: [team("20245", "Ultraviolet"), team("23268", "Ultraviolet")], pages: [], step: "deterministic", weak: false, understood: { kind: "names", label: "Teams, events and matches matching \"ultraviolet\"" } });
    expect(at()).toBe("/search?q=ultraviolet");
  });
  it("\"6980 record\" (a topic of the team): the results page, which answers it", async () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "6980 record" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await answerWith(one("6980 record", { ...BAD_WOLF, section: "ranking" }, { understood: { kind: "team", label: "Bad Wolf (6980) — Ranking and record" } }));
    expect(at()).toBe("/search?q=6980%20record");
  });
  it("an event code: that event's page", async () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "usnjnem2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await answerWith({ q: "usnjnem2", hits: [{ kind: "event", ref: "2026:USNJNEM2", title: "P1-5 AM Northeast League Meet", subtitle: "", season: 2026, match: "exact" }], pages: [], step: "deterministic", weak: false });
    expect(at()).toBe("/events/2026/USNJNEM2");
  });
  it("the request failing: the results page (never stuck)", async () => {
    const input = mount();
    fireEvent.change(input, { target: { value: "6980" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const [p] = pending.splice(0, 1);
    await act(async () => { (p.resolve as (v: unknown) => void)(Promise.reject(new Error("offline"))); });
    expect(at()).toBe("/search?q=6980");
  });
});
