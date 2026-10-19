// The directory's URL state: country, sort, direction and page round-trip through a
// link (so paging, sorting, back/forward and copied URLs keep them), the page's own
// params (view, season) are left alone, and an unknown country is kept visible.
import { describe, expect, it } from "vitest";
import { directoryUrl, parseDirectoryState, writeDirectoryState } from "./directoryState";

const sp = (s: string) => new URLSearchParams(s);

describe("directory URL state", () => {
  it("reads the defaults from a bare link", () => {
    expect(parseDirectoryState(sp("view=listed"))).toEqual({ country: null, unknownCountry: null, sort: "team", dir: "asc", page: 1 });
  });

  it("round-trips country, sort, direction and page, keeping view and season", () => {
    const s = parseDirectoryState(sp("view=listed&season=2025&country=us&sort=name&dir=desc&page=3"));
    expect(s).toEqual({ country: "US", unknownCountry: null, sort: "name", dir: "desc", page: 3 });
    const out = writeDirectoryState(sp("view=listed&season=2025"), s);
    expect(out.toString()).toBe("view=listed&season=2025&country=US&sort=name&dir=desc&page=3");
    expect(parseDirectoryState(out)).toEqual(s);
  });

  it("leaves defaults out of the link", () => {
    const out = writeDirectoryState(sp("view=listed&country=US&sort=name&page=4"), { country: "US", sort: "results", dir: "desc", page: 1 });
    expect(out.toString()).toBe("view=listed&country=US&sort=results");
  });

  it("keeps an unknown country visible instead of dropping it, and ignores junk", () => {
    expect(parseDirectoryState(sp("country=ZZ&sort=opr&dir=up&page=-2"))).toEqual({ country: null, unknownCountry: "ZZ", sort: "team", dir: "asc", page: 1 });
  });

  it("asks the API for the same rows", () => {
    expect(directoryUrl(2026, parseDirectoryState(sp("country=CA&sort=rookie&page=2"))))
      .toBe("/api/directory/2026?country=CA&sort=rookie&dir=asc&page=2&pageSize=50");
  });
});
