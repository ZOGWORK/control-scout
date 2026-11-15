// @vitest-environment jsdom
// "Capture this screen" in the Report a bug dialog (#1558) against a stubbed getDisplayMedia: the button is there only
// where the browser can share a tab, a capture becomes an image attachment and stops sharing at once, a refused prompt
// leaves a short note and nothing attached, and six screenshots already attached means no prompt at all. Also the
// dialog's thin, theme-coloured scrollbar (#1559).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BUG_LIMITS } from "../../shared/bugReport";

vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ palette: "dark", theme: "dark" }) }));
vi.mock("../../lib/personal", () => ({ usePersonal: () => ({ user: null, providers: {}, state: { myTeam: null }, syncReady: false }) }));

const { BugReportButton } = await import("./BugReport");
const { CAPTURING_ATTR, canCaptureScreen } = await import("./captureScreen");

const stopped: number[] = [];
let hiddenWhileDrawn: boolean | null = null;
const track = (n: number) => ({ stop: () => { stopped.push(n); } });
const okStream = () => ({ getTracks: () => [track(1)] }) as unknown as MediaStream;

function withDisplayMedia(impl: (() => Promise<MediaStream>) | undefined) {
  const getDisplayMedia = impl ? vi.fn(impl) : undefined;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: getDisplayMedia ? { getDisplayMedia } : {} });
  return getDisplayMedia;
}

const protos: Array<[object, string, PropertyDescriptor | undefined]> = [];
function stubProto(proto: object, key: string, desc: PropertyDescriptor) {
  protos.push([proto, key, Object.getOwnPropertyDescriptor(proto, key)]);
  Object.defineProperty(proto, key, { configurable: true, ...desc });
}

beforeEach(() => {
  stopped.length = 0;
  hiddenWhileDrawn = null;
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
  let urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++urls}`);
  URL.revokeObjectURL = vi.fn();
  stubProto(HTMLMediaElement.prototype, "play", { value: () => Promise.resolve() });
  stubProto(HTMLVideoElement.prototype, "videoWidth", { get: () => 1600 });
  stubProto(HTMLVideoElement.prototype, "videoHeight", { get: () => 900 });
  stubProto(HTMLVideoElement.prototype, "requestVideoFrameCallback", { value: (cb: () => void) => setTimeout(cb, 0) });
  stubProto(HTMLCanvasElement.prototype, "getContext", {
    value: () => ({ drawImage: () => { hiddenWhileDrawn = document.documentElement.hasAttribute(CAPTURING_ATTR); } }),
  });
  stubProto(HTMLCanvasElement.prototype, "toBlob", { value: (cb: (b: Blob) => void, type: string) => cb(new Blob([new Uint8Array(2048)], { type })) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [proto, key, desc] of protos.splice(0).reverse()) {
    if (desc) Object.defineProperty(proto, key, desc);
    else delete (proto as Record<string, unknown>)[key];
  }
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
  document.documentElement.removeAttribute(CAPTURING_ATTR);
});

async function open() {
  render(<MemoryRouter initialEntries={["/search"]}><BugReportButton /></MemoryRouter>);
  fireEvent.click(screen.getByTestId("bug-report-button"));
  await screen.findByTestId("bug-report-form");
}

describe("Capture this screen", () => {
  it("is offered only where the browser can share a tab or screen", async () => {
    withDisplayMedia(undefined);
    expect(canCaptureScreen()).toBe(false);
    await open();
    expect(screen.queryByTestId("bug-capture")).toBeNull();
    cleanup();

    withDisplayMedia(async () => okStream());
    expect(canCaptureScreen()).toBe(true);
    await open();
    expect(screen.getByRole("button", { name: /Capture this screen/ })).toBeTruthy();
  });

  it("is not offered when the page's permissions policy turns screen capture off", () => {
    withDisplayMedia(async () => okStream());
    Object.defineProperty(document, "featurePolicy", { configurable: true, value: { allowsFeature: (f: string) => f !== "display-capture" } });
    try { expect(canCaptureScreen()).toBe(false); } finally { delete (document as unknown as Record<string, unknown>).featurePolicy; }
  });

  it("adds one frame of the page as an image, with the dialog hidden for it, and stops sharing at once", async () => {
    const ask = withDisplayMedia(async () => okStream());
    await open();
    fireEvent.click(screen.getByTestId("bug-capture"));
    const shot = await screen.findByRole("img", { name: "screen-capture-1.png" });
    expect(shot).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask!.mock.calls[0]![0]).toMatchObject({ video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" });
    // Drawn while the dialog and its backdrop were out of the way, and back afterwards.
    expect(hiddenWhileDrawn).toBe(true);
    expect(document.documentElement.hasAttribute(CAPTURING_ATTR)).toBe(false);
    expect(stopped.length).toBeGreaterThan(0);
    expect(screen.getByText(`1/${BUG_LIMITS.images} images · 0/${BUG_LIMITS.videos} video`)).toBeTruthy();
    expect(screen.queryByTestId("bug-capture-note")).toBeNull();
    // A second capture gets its own name.
    fireEvent.click(screen.getByTestId("bug-capture"));
    expect(await screen.findByRole("img", { name: "screen-capture-2.png" })).toBeTruthy();
  });

  it("a refused or cancelled prompt: a short note, nothing attached, no error", async () => {
    withDisplayMedia(async () => { throw new DOMException("Permission denied", "NotAllowedError"); });
    await open();
    fireEvent.click(screen.getByTestId("bug-capture"));
    const note = await screen.findByTestId("bug-capture-note");
    expect(note.textContent).toBe("No screen captured. You can paste or choose a screenshot instead.");
    expect(screen.queryAllByTestId("bug-attachment")).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.documentElement.hasAttribute(CAPTURING_ATTR)).toBe(false);
    // The button is back, ready to try again.
    await waitFor(() => expect((screen.getByTestId("bug-capture") as HTMLButtonElement).disabled).toBe(false));
  });

  it("with six screenshots attached, says it's full and never asks the browser", async () => {
    const ask = withDisplayMedia(async () => okStream());
    await open();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const pngs = Array.from({ length: BUG_LIMITS.images }, (_, i) => new File([new Uint8Array(10)], `shot-${i}.png`, { type: "image/png" }));
    fireEvent.change(input, { target: { files: pngs } });
    expect(await screen.findAllByTestId("bug-attachment")).toHaveLength(BUG_LIMITS.images);
    fireEvent.click(screen.getByTestId("bug-capture"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/screenshot/i);
    expect(ask).not.toHaveBeenCalled();
    expect(screen.getAllByTestId("bug-attachment")).toHaveLength(BUG_LIMITS.images);
  });
});

describe("the dialog's scrollbar", () => {
  it("is the app's thin, theme-coloured one", async () => {
    withDisplayMedia(undefined);
    await open();
    const content = document.querySelector('[data-slot="dialog-content"]')!;
    expect(content.classList.contains("custom-scrollbar")).toBe(true);
    expect(content.classList.contains("overflow-y-auto")).toBe(true);
  });
});
