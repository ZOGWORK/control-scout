// The answer's sections in order (./searchSections.ts): a place's events put the place's pages beside the place, above
// its events; any other answer keeps its pages after its results.
import { describe, expect, it } from "vitest";
import { answerSections } from "./searchSections";
import type { SearchAnswer, SearchHit } from "./api";

const place: SearchHit = { kind: "place", ref: "USA:NJ", title: "All events in New Jersey", subtitle: "", season: 2026 };
const event: SearchHit = { kind: "event", ref: "2026:USNJNOM3", title: "P2-3 Northern League Meet", subtitle: "", season: 2026 };
const pages = [{ title: "Rankings in New Jersey", href: "/rankings/regions/USA/NJ" }];
const of = (a: Partial<SearchAnswer>) => answerSections({ q: "nj", hits: [place, event], pages, step: "deterministic", weak: false, ...a } as SearchAnswer).sections.map((s) => s.id);

describe("answer sections", () => {
  it("puts a place's pages right under the place, above its events", () => {
    expect(of({ understood: { kind: "events", label: "Events in New Jersey" } })).toEqual(["place", "pages", "event"]);
  });
  it("keeps pages after the results for any other answer", () => {
    expect(of({ understood: { kind: "names", label: "Teams, events and matches matching \"nj\"" } })).toEqual(["place", "event", "pages"]);
    expect(of({ hits: [event], understood: { kind: "events", label: "Meets" } })).toEqual(["event", "pages"]);
  });
});
