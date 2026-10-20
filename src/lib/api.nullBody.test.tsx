// @vitest-environment jsdom
// A 200 whose body is valid JSON but not an object (audit PUB3-F04): a page waiting for its data must not wait
// forever. Every cached read (useApi) treats a null, number or string answer as a failed one it can try again,
// and the team directory also checks the answer's shape. Try again works once the server answers properly, and
// the directory keeps the selected country and season meanwhile.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { invalidate, useApi } from "./api";
import { Async } from "../components/states";
import { isDirectoryPage, type DirectoryPage } from "../shared/directory";

vi.mock("./personal", () => ({ useTeamFlags: () => ({ tracked: false, toggleTracked: () => {} }) }));
vi.mock("./meta", async (orig) => ({ ...(await orig<typeof import("./meta")>()), useMeta: () => null }));
const { TeamDirectory } = await import("../components/records/TeamDirectory");

const answers = new Map<string, string>();
beforeEach(() => {
  answers.clear();
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(answers.get(path) ?? "{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); invalidate("/api/"); });

function Thing({ path }: { path: string }) {
  const state = useApi<{ name: string }>(path);
  return <Async state={state}>{(d) => <p>Thing {d.name}</p>}</Async>;
}

describe("useApi: a 200 that isn't an object", () => {
  it.each([["null"], ["42"], ['"ok"'], ["true"]])("%s is an error with Try again, and the repaired answer shows", async (body) => {
    const path = `/api/t/not-object-${body.replace(/\W/g, "")}`;
    answers.set(path, body);
    render(<Thing path={path} />);
    const retry = await screen.findByRole("button", { name: /Try again/ });
    expect(screen.getByText(/empty or not in the expected form/)).toBeTruthy();
    answers.set(path, JSON.stringify({ name: "Repaired" }));
    fireEvent.click(retry);
    expect(await screen.findByText("Thing Repaired")).toBeTruthy();
  });
});

const good: DirectoryPage = {
  season: 2025, country: "CA", total: 2, withResults: 1, unplaced: 0, page: 1, pageSize: 50, sort: "team", dir: "asc",
  readiness: { state: "ready", resultsAt: "2026-10-17T12:00:00Z", statsAt: "2026-10-17T12:05:00Z" },
  rows: [
    { team: 30, name: "Maple", city: "Toronto", state: "ON", country: "Canada", rookieYear: 2022, hasResults: false },
    { team: 31, name: "Moose", city: null, state: null, country: "Canada", rookieYear: null, hasResults: true },
  ],
};
const DIR = "/api/directory/2025?country=CA&sort=team&dir=asc&page=1&pageSize=50";
const mount = () => render(<MemoryRouter initialEntries={["/teams?view=listed&season=2025&country=CA"]}><TeamDirectory season={2025} onSeason={() => {}} /></MemoryRouter>);

describe("TeamDirectory: an answer it can't use", () => {
  it.each([
    ["a JSON null", "null"],
    ["an object without rows", JSON.stringify({ ...good, rows: undefined })],
    ["a row without a team number", JSON.stringify({ ...good, rows: [{ name: "No number", hasResults: false }] })],
  ])("%s: an error with Try again (not endless loading), keeping the country; Try again shows the repaired page", async (_, body) => {
    answers.set(DIR, body);
    mount();
    const retry = await screen.findByRole("button", { name: /Try again/ });
    expect(screen.queryByLabelText("Loading the team directory")).toBeNull();
    expect((screen.getByRole("combobox", { name: "Country" }) as HTMLSelectElement).value).toBe("CA");
    answers.set(DIR, JSON.stringify(good));
    fireEvent.click(retry);
    expect(await screen.findByRole("link", { name: /Maple/ })).toBeTruthy();
    expect((screen.getByRole("combobox", { name: "Country" }) as HTMLSelectElement).value).toBe("CA");
  });
});

describe("isDirectoryPage", () => {
  it("takes a real page and refuses partial ones", () => {
    expect(isDirectoryPage(good)).toBe(true);
    expect(isDirectoryPage({ ...good, rows: [] })).toBe(true);
    for (const bad of [null, [], {}, { ...good, total: "2" }, { ...good, sort: "nope" }, { ...good, readiness: null }, { ...good, pageSize: 0 }]) {
      expect(isDirectoryPage(bad)).toBe(false);
    }
  });
});
