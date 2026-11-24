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
    expect(sessionStorage.getItem("cs-last-search")).toBe("4215 auto points");
    expect(lib.lastSearch("was that the same in all the matches you said")).toBe("4215 auto points");
    expect(lib.lastSearch("4215 Auto Points")).toBeNull();
  });
  it("is kept in memory when storage refuses the write but still reads", () => {
    lib.rememberSearch("4215 opr");
    refuse("setItem");
    lib.rememberSearch("4215 auto points");
    // Storage still holds the older one: the latest is read from memory.
    expect(sessionStorage.getItem("cs-last-search")).toBe("4215 opr");
    expect(lib.lastSearch()).toBe("4215 auto points");
  });
  it("is kept in memory when storage refuses both", () => {
    refuse("setItem");
    refuse("getItem");
    lib.rememberSearch("4215 auto points");
    expect(lib.lastSearch()).toBe("4215 auto points");
  });
  it("is storage's again once a write goes through, so memory never shadows a newer one", () => {
    const set = refuse("setItem");
    lib.rememberSearch("4215 opr");
    set.mockRestore();
    lib.rememberSearch("4215 auto points");
    expect(lib.lastSearch()).toBe("4215 auto points");
    sessionStorage.clear();
    expect(lib.lastSearch()).toBeNull();
  });
});
