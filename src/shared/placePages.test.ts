// A place's own pages in search (./placePages.ts): the place alone links them all, its words ask for one; New Jersey
// alone has conferences; anything more than a place and those words is left as it was.
import { describe, expect, it } from "vitest";
import { placeAsk, placePages, withPlacePages } from "./placePages";

const hrefs = (q: string) => withPlacePages(q, [{ title: "Rankings", href: "/rankings" }]).map((p) => p.href);

describe("a place's pages", () => {
  it("links a place's rankings, leagues and (New Jersey's) conferences, for its code or its name", () => {
    for (const q of ["nj", "NJ", "new jersey", "New Jersey"]) {
      expect(hrefs(q)).toEqual(["/rankings/regions/USA/NJ", "/leagues?q=New%20Jersey", "/search?q=New%20Jersey%20conferences", "/rankings"]);
    }
    expect(placePages(placeAsk("texas")!.region).map((p) => p.title)).toEqual(["Rankings in Texas", "Leagues in Texas"]);
  });

  it("puts the page a place's words ask for first, the rest left out", () => {
    expect(hrefs("nj rankings")).toEqual(["/rankings/regions/USA/NJ", "/rankings"]);
    expect(hrefs("show me the new jersey rankings")).toEqual(["/rankings/regions/USA/NJ", "/rankings"]);
    expect(hrefs("nj leagues")).toEqual(["/leagues?q=New%20Jersey", "/rankings"]);
    // The conferences asked for are the answer itself: no link to the same search.
    expect(hrefs("nj conferences")).toEqual(["/rankings"]);
    expect(hrefs("texas conferences")).toEqual(["/rankings"]);
  });

  it("keeps the answer's own link to a page, its season named, instead of adding it twice", () => {
    const own = withPlacePages("nj rankings", [{ title: "Top teams in New Jersey", href: "/rankings/regions/USA/NJ?season=2025" }, { title: "Rankings", href: "/rankings" }]);
    expect(own.map((p) => p.href)).toEqual(["/rankings/regions/USA/NJ?season=2025", "/rankings"]);
  });

  it("leaves anything more than a place alone", () => {
    for (const q of ["4215 nj rankings", "nj meets this weekend", "east bergen rankings", "rankings", "top teams in nj"]) expect(hrefs(q)).toEqual(["/rankings"]);
  });
});
