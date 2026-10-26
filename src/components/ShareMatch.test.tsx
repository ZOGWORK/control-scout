// @vitest-environment jsdom
// Sharing a card: the share sheet with the image where the browser can take
// files, otherwise (no navigator.share, no file support, a failed sheet) a
// download; closing the sheet is not a failure.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShareMatch } from "./ShareMatch";
import { CARD_FILE_TTL_MS, canShareFiles, cardFile, shareCard } from "../lib/shareCard";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let n = 0;
const q = () => ({ season: 2025, red: [4215, 16379 + n], blue: [33950, 21058] }); // a fresh address per test (files are kept per address)
const nav = navigator as unknown as { share?: unknown; canShare?: unknown };
let clicked: HTMLAnchorElement[] = [];
/** Every object URL made, and the blob behind it. */
let blobs = new Map<string, Blob>();

beforeEach(() => {
  n++;
  clicked = [];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([PNG], { type: "image/png" }), { status: 200, headers: { "content-type": "image/png" } })));
  blobs = new Map();
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => { const u = `blob:card-${blobs.size + 1}`; blobs.set(u, b as Blob); return u; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
  delete nav.share;
  delete nav.canShare;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete nav.share; delete nav.canShare; });

describe("shareCard", () => {
  it("no navigator.share: downloads the PNG under a readable name", async () => {
    expect(canShareFiles()).toBe(false);
    expect(await shareCard(q(), "Our model gives…")).toBe("downloaded");
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe(`control-scout-4215-${16379 + n}-vs-33950-21058.png`);
    expect(clicked[0].href).toMatch(/^blob:card-\d+$/);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/share/match.png?season=2025&red=4215,${16379 + n}&blue=33950,21058`);
  });

  it("navigator.share without file support: still a download", async () => {
    nav.share = vi.fn();
    nav.canShare = vi.fn(() => false);
    expect(await shareCard(q(), "x")).toBe("downloaded");
    expect(nav.share).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(1);
  });

  it("file sharing supported: the share sheet gets the image, with the link in the text", async () => {
    nav.share = vi.fn(async () => {});
    nav.canShare = vi.fn((d: { files?: File[] }) => !!d.files?.length);
    expect(await shareCard(q(), "Our model gives 4215 a 73% win chance vs 33950")).toBe("shared");
    const data = vi.mocked(nav.share as (d: ShareData) => Promise<void>).mock.calls[0][0];
    expect(data.files?.[0].type).toBe("image/png");
    expect(data.files?.[0].name).toMatch(/\.png$/);
    expect(data.text).toContain("Our model gives 4215 a 73% win chance vs 33950");
    expect(data.text).toContain(`${location.origin}/predict?mode=match&season=2025&red=4215,${16379 + n}&blue=33950,21058`);
    expect(clicked).toHaveLength(0);
  });

  it("closing the sheet is not a failure (no download); a sheet that fails falls back to one", async () => {
    nav.canShare = vi.fn(() => true);
    nav.share = vi.fn(async () => { throw new DOMException("closed", "AbortError"); });
    expect(await shareCard(q(), "x")).toBe("cancelled");
    expect(clicked).toHaveLength(0);
    nav.share = vi.fn(async () => { throw new DOMException("nope", "NotAllowedError"); });
    expect(await shareCard(q(), "x")).toBe("downloaded");
    expect(clicked).toHaveLength(1);
  });

  it("reuses a fetched card for a few minutes, then fetches it again (revalidated, never stale from the HTTP cache)", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const query = q();
    await cardFile(query);
    await cardFile(query);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toEqual({ cache: "no-cache" });
    clock.mockReturnValue(now + CARD_FILE_TTL_MS + 1);
    await cardFile(query);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a server error says so instead of downloading a broken file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Ratings for this season aren't ready yet." }), { status: 503, headers: { "content-type": "application/json" } })));
    await expect(shareCard(q(), "x")).rejects.toThrow("Ratings for this season aren't ready yet.");
    expect(clicked).toHaveLength(0);
  });
});

describe("ShareMatch", () => {
  it("without a share sheet the panel offers a download and the link, and the download works", async () => {
    render(<ShareMatch query={q()} pRed={0.73} tier="moderate" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    const download = await screen.findByRole("button", { name: /download image/i });
    expect(screen.getByRole("button", { name: /copy link/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /share image/i })).toBeNull();
    const img = await screen.findByRole("img", { name: /Our model gives 4215 & \d+ a 73% win chance vs 33950 & 21058 \(confidence: fair\)/ });
    fireEvent.click(download);
    await waitFor(() => expect(clicked).toHaveLength(1));
    // The download is the very file the preview shows.
    expect(blobs.get(clicked[0].href)).toBe(blobs.get(img.getAttribute("src")!));
  });

  it("previews the same fetched file it shares (never the address, which the browser may hold an older copy of), and frees it on change and close", async () => {
    nav.share = vi.fn(async () => {});
    nav.canShare = vi.fn(() => true);
    const { unmount } = render(<ShareMatch query={q()} pRed={0.73} tier="moderate" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    const img = await screen.findByRole("img");
    const wide = img.getAttribute("src")!;
    expect(wide).toMatch(/^blob:card-\d+$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /share image/i }));
    await waitFor(() => expect(nav.share).toHaveBeenCalled());
    const sent = vi.mocked(nav.share as (d: ShareData) => Promise<void>).mock.calls[0][0];
    expect(sent.text).toContain("win chance vs 33950 & 21058 (confidence: fair)"); // the tier travels with the %
    const shared = sent.files![0];
    expect(shared).toBe(blobs.get(wide));
    expect(fetch).toHaveBeenCalledTimes(1); // shared from memory, no second fetch
    // Another shape: a new preview, the old one released.
    fireEvent.click(screen.getByRole("radio", { name: /square/i }));
    await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).not.toBe(wide));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(wide);
    const square = screen.getByRole("img").getAttribute("src")!;
    expect((blobs.get(square) as File).name).toMatch(/-square\.png$/);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(square);
  });

  it("says so in the preview when the image can't be made", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Ratings for this season aren't ready yet." }), { status: 503, headers: { "content-type": "application/json" } })));
    render(<ShareMatch query={q()} pRed={0.73} tier="moderate" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(await screen.findByText("Ratings for this season aren't ready yet.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("with a share sheet that takes files the panel offers it, and a square option for Instagram", async () => {
    nav.share = vi.fn(async () => {});
    nav.canShare = vi.fn(() => true);
    render(<ShareMatch query={q()} pRed={0.3} tier="moderate" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    expect(await screen.findByRole("button", { name: /share image/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /square/i }));
    await waitFor(() => expect((blobs.get(screen.getByRole("img").getAttribute("src")!) as File | undefined)?.name).toMatch(/-square\.png$/));
    expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain("format=square");
    fireEvent.click(screen.getByRole("button", { name: /share image/i }));
    await waitFor(() => expect(nav.share).toHaveBeenCalled());
    expect(vi.mocked(nav.share as (d: ShareData) => Promise<void>).mock.calls[0][0].files?.[0].name).toMatch(/-square\.png$/);
  });
});
