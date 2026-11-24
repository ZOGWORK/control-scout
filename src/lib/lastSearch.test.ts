// @vitest-environment jsdom
// The tab's last answered search (./lastSearch.ts), which a follow-up question is read with: kept in sessionStorage,
// and in memory whenever storage refuses the write or the read, so a follow-up still finds it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lib: typeof import("./lastSearch");
beforeEach(async () => { sessionStorage.clear(); vi.resetModules(); lib = await import("./lastSearch"); });
afterEach(() => vi.restoreAllMocks());

const refuse = (method: "setItem" | "getItem") => vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error("blocked"); });

describe("the tab's last search", () => {
  it("is kept in sessionStorage, and never offered for the same search again", () => {
    lib.rememberSearch("  4215   auto points ");
    expect(JSON.parse(sessionStorage.getItem("cs-last-search")!)).toEqual({ q: "4215 auto points", season: null });
    expect(lib.lastSearch("was that the same in all the matches you said")).toEqual({ q: "4215 auto points", season: null });
    expect(lib.lastSearch("4215 Auto Points")).toBeNull();
  });
  it("is kept in memory when storage refuses the write but still reads", () => {
    lib.rememberSearch("4215 opr");
    refuse("setItem");
    lib.rememberSearch("4215 auto points");
    // Storage still holds the older one: the latest is read from memory.
    expect(JSON.parse(sessionStorage.getItem("cs-last-search")!).q).toBe("4215 opr");
    expect(lib.lastSearch()?.q).toBe("4215 auto points");
  });
  it("is kept in memory when storage refuses both", () => {
    refuse("setItem");
    refuse("getItem");
    lib.rememberSearch("4215 auto points");
    expect(lib.lastSearch()?.q).toBe("4215 auto points");
  });
  it("keeps the season picked on its answer, so a follow-up reads that season's records", () => {
    lib.rememberSearch("4215 auto points", 2024);
    expect(lib.lastSearch()).toEqual({ q: "4215 auto points", season: 2024 });
    refuse("setItem");
    lib.rememberSearch("4215 opr", 2023);
    expect(lib.lastSearch()).toEqual({ q: "4215 opr", season: 2023 });
  });
  it("reads nothing from a value it didn't write", () => {
    sessionStorage.setItem("cs-last-search", "not json");
    expect(lib.lastSearch()).toBeNull();
  });
  it("is storage's again once a write goes through, so memory never shadows a newer one", () => {
    const set = refuse("setItem");
    lib.rememberSearch("4215 opr");
    set.mockRestore();
    lib.rememberSearch("4215 auto points");
    expect(lib.lastSearch()?.q).toBe("4215 auto points");
    sessionStorage.clear();
    expect(lib.lastSearch()).toBeNull();
  });
});
