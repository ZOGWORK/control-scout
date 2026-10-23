// @vitest-environment jsdom
// Recording a match without the in-page camera: a video filmed with the camera app (or any video file) is kept
// on this device like a recording, and a browser that can't record still offers it.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saved: { matchRef: string; label: string; mime: string }[] = [];
vi.mock("../lib/recordings", async (orig) => ({
  ...(await orig<typeof import("../lib/recordings")>()),
  saveRecording: vi.fn(async (r: { matchRef: string; label: string; mime: string }) => { saved.push(r); return r; }),
  listRecordings: vi.fn(async () => []),
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ state: { videoLinks: {} }, update: () => true }) }));
vi.mock("./ui/sonner", () => ({ toast: { success: vi.fn() } }));

const { VideoPanel, mimeOfName, extOfMime } = await import("./MatchVideo");

beforeEach(() => { saved.length = 0; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Record: choose a video", () => {
  it("keeps a chosen video for the match, even where the browser can't record", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VideoPanel matchRef="2025:X:Q1" label="X Q1" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record" }));
    fireEvent.click(screen.getByRole("tab", { name: "Record" }));
    expect(await screen.findByText(/film with your camera app and add the video/)).toBeTruthy();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.accept).toBe("video/*");
    fireEvent.change(input, { target: { files: [new File(["x"], "q1.mp4", { type: "video/mp4" })] } });
    await waitFor(() => expect(saved).toEqual([expect.objectContaining({ matchRef: "2025:X:Q1", label: "X Q1", mime: "video/mp4" })]), { timeout: 4000 });
  });

  it("turns away a file that isn't a video", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VideoPanel matchRef="2025:X:Q1" label="X Q1" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record" }));
    fireEvent.click(screen.getByRole("tab", { name: "Record" }));
    const input = (await waitFor(() => document.querySelector<HTMLInputElement>('input[type="file"]')!))!;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(await screen.findByText("That file isn't a video.")).toBeTruthy();
    expect(saved).toHaveLength(0);
  });
});

describe("video types", () => {
  it("knows a video by its name when the browser gives no type, and downloads it with its own extension", () => {
    expect(mimeOfName("Q1.MOV")).toBe("video/quicktime");
    expect(mimeOfName("notes.txt")).toBeNull();
    expect(extOfMime("video/quicktime")).toBe("mov");
    expect(extOfMime("video/webm;codecs=vp9")).toBe("webm");
    expect(extOfMime("video/mp4;codecs=avc1")).toBe("mp4");
  });

  it("saves a picked video whose type the browser left empty", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    render(<VideoPanel matchRef="2025:X:Q1" label="X Q1" />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Record" }));
    fireEvent.click(screen.getByRole("tab", { name: "Record" }));
    const input = (await waitFor(() => document.querySelector<HTMLInputElement>('input[type="file"]')!))!;
    fireEvent.change(input, { target: { files: [new File(["x"], "q1.mov", { type: "" })] } });
    await waitFor(() => expect(saved).toEqual([expect.objectContaining({ mime: "video/quicktime" })]), { timeout: 4000 });
  });
});
