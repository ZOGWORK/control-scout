// @vitest-environment jsdom
// The library's lists and notes (LibraryViews.tsx): reading again after a change, retrying a later page, and a note's
// links opening the watch page with the video they're about.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryPage, NotesPage, VideoNote } from "../../shared/videoLibrary";
import type { FeedItem } from "../../shared/videosFeed";

const lib = vi.hoisted(() => ({
  version: 0,
  listeners: new Set<() => void>(),
  libraryPage: vi.fn<(signedIn: boolean, list: string, cursor: string | null) => Promise<LibraryPage>>(),
  notesPage: vi.fn<(signedIn: boolean, cursor: string | null) => Promise<NotesPage>>(),
}));
vi.mock("../../lib/videoLibrary", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    libraryPage: lib.libraryPage, notesPage: lib.notesPage, setInList: vi.fn(async () => {}), clearList: vi.fn(async () => {}),
    useLibraryVersion: () => useSyncExternalStore((cb) => { lib.listeners.add(cb); return () => lib.listeners.delete(cb); }, () => lib.version),
  };
});
vi.mock("../FeedCard", () => ({ FeedCard: ({ item }: { item: FeedItem }) => <div data-card={item.key}>{item.title}</div> }));
const { LibraryListView, NotesView } = await import("./LibraryViews");

const item = (n: number, o: Partial<FeedItem> = {}) => ({ key: `m:2025:X:q:1:${n}`, kind: "match", videoId: "abcdefghijk", t: 30 + n, end: 200, title: `Q${n}`, teams: [], ...o }) as unknown as FeedItem;
const page = (from: number, n: number, next: string | null): LibraryPage => ({ items: Array.from({ length: n }, (_, i) => ({ item: item(from + i), at: "2026-11-01T00:00:00Z" })), next });
const bump = () => act(() => { lib.version++; for (const l of lib.listeners) l(); });

// The end of the list in view (each page asks for the next at once) while `endInView` is on.
let endInView = true;
class SeeAll { cb: IntersectionObserverCallback; constructor(cb: IntersectionObserverCallback) { this.cb = cb; } observe() { if (endInView) this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} unobserve() {} }
beforeEach(() => { endInView = true; lib.version = 0; lib.libraryPage.mockReset(); lib.notesPage.mockReset(); vi.stubGlobal("IntersectionObserver", SeeAll); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("a library list read again after a change", () => {
  it("keeps every page that was shown, not only the first", async () => {
    lib.libraryPage.mockImplementation(async (_s, _l, c) => (c == null ? page(0, 24, "p2") : c === "p2" ? page(24, 24, "p3") : page(48, 5, null)));
    const r = render(<MemoryRouter><LibraryListView list="history" signedIn cols={3} /></MemoryRouter>);
    await waitFor(() => expect(r.container.querySelectorAll("[data-card]").length).toBe(53));
    // Scrolled back up: the end is out of view, so nothing more is asked for by scrolling.
    endInView = false;
    bump();
    await waitFor(() => expect(lib.libraryPage.mock.calls.length).toBe(6));
    await act(async () => {});
    expect(r.container.querySelectorAll("[data-card]").length).toBe(53);
  });
});

const note = (id: number, it: FeedItem, t: number | null): VideoNote => ({ id: String(id), key: it.key, videoId: it.videoId, t, body: `note ${id}`, item: it, createdAt: "", updatedAt: "" });

function WatchProbe() {
  const loc = useLocation();
  return <p data-watch-state>{JSON.stringify((loc.state as { item?: FeedItem } | null)?.item?.key ?? null)}</p>;
}

describe("Notes", () => {
  it("a note's links open the watch page with its video (a match clip has no other way to know it)", async () => {
    const it = item(7);
    lib.notesPage.mockResolvedValue({ notes: [note(1, it, 42)], next: null });
    for (const name of [/^Watch Q7$/, /^Q7$/, /^Watch from/]) {
      cleanup();
      render(<MemoryRouter><Routes><Route path="/" element={<NotesView signedIn />} /><Route path="/watch/:id" element={<WatchProbe />} /></Routes></MemoryRouter>);
      fireEvent.click(await screen.findByRole("link", { name }));
      expect(screen.getByText(JSON.stringify(it.key))).toBeTruthy();
    }
  });

  it("a later page that fails can be tried again", async () => {
    let fail = true;
    lib.notesPage.mockImplementation(async (_s, c) => {
      if (c == null) return { notes: [note(1, item(1), 5)], next: "n2" };
      if (fail) throw new Error("offline");
      return { notes: [note(2, item(2), 9)], next: null };
    });
    render(<MemoryRouter><NotesView signedIn /></MemoryRouter>);
    const retry = await screen.findByRole("button", { name: "Couldn't load more. Try again" });
    fail = false;
    fireEvent.click(retry);
    expect(await screen.findByText("note 2")).toBeTruthy();
  });
});
