/** @vitest-environment jsdom */
// /search starts from the server's first-paint results: read from the JSON block, kept on screen while the
// first request refreshes them (never blanked to "Searching…").
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { readBootHits } from "./searchBoot";
import { SEARCH_HITS_ID } from "../shared/search";
import { useSearchHits } from "../components/search/SearchBox";
import { PersonalProvider } from "./personal";

const doc = (html: string) => { const d = document.implementation.createHTMLDocument(""); d.body.innerHTML = html; return d; };
const hit = { kind: "team" as const, ref: "4215", title: "4215 Hypnotic Robotics", subtitle: "Oradell, NJ, USA", season: 2025 };

describe("search boot hits", () => {
  it("reads the query and hits from the first paint's block, and nothing else", () => {
    expect(readBootHits(doc(`<script type="application/json" id="${SEARCH_HITS_ID}">${JSON.stringify({ q: "4215", hits: [hit] })}</script>`))).toEqual({ q: "4215", hits: [hit] });
    expect(readBootHits(doc(""))).toBeNull();
    expect(readBootHits(doc(`<script type="application/json" id="${SEARCH_HITS_ID}">{oops</script>`))).toBeNull();
    expect(readBootHits(doc(`<script type="application/json" id="${SEARCH_HITS_ID}">{"q":"x"}</script>`))).toBeNull();
  });

  it("useSearchHits shows the initial hits for their query at once, and none for another query", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const wrapper = ({ children }: { children: ReactNode }) => <PersonalProvider>{children}</PersonalProvider>;
    const same = renderHook(() => useSearchHits("4215", undefined, 25, { q: "4215", hits: [hit] }), { wrapper });
    expect(same.result.current.hits).toEqual([hit]);
    const other = renderHook(() => useSearchHits("4216", undefined, 25, { q: "4215", hits: [hit] }), { wrapper });
    expect(other.result.current.hits).toEqual([]);
    vi.unstubAllGlobals();
  });
});
