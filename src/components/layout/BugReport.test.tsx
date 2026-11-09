// The bug report dialog's attachment rules: what a paste or drop yields, which files are kept and why one is refused
// (types, the 5 MB video cap, one video, six screenshots), and the short device name.
import { describe, expect, it } from "vitest";
import { addFiles, deviceOf, filesFrom } from "./BugReport";
import { BUG_LIMITS } from "../../shared/bugReport";

const file = (type: string, bytes: number, name = "f") => new File([new Uint8Array(bytes)], name, { type });

describe("filesFrom (paste and drop)", () => {
  it("takes the files list when the browser fills it", () => {
    const png = file("image/png", 10);
    expect(filesFrom({ files: [png] as unknown as FileList, items: [] as unknown as DataTransferItemList })).toEqual([png]);
  });
  it("falls back to file items (a pasted screenshot in some browsers), ignoring text", () => {
    const png = file("image/png", 10);
    const items = [
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => png },
    ] as unknown as DataTransferItemList;
    expect(filesFrom({ files: [] as unknown as FileList, items })).toEqual([png]);
  });
  it("is empty for a text-only paste or no clipboard", () => {
    expect(filesFrom(null)).toEqual([]);
    expect(filesFrom({ files: [] as unknown as FileList, items: [{ kind: "string", getAsFile: () => null }] as unknown as DataTransferItemList })).toEqual([]);
  });
});

describe("addFiles", () => {
  it("keeps screenshots and one video under 5 MB", () => {
    const r = addFiles([], [file("image/png", 100), file("video/mp4", BUG_LIMITS.videoBytes - 1)]);
    expect(r.add).toHaveLength(2);
    expect(r.problem).toBeNull();
  });
  it("refuses a video over 5 MB with a clear message, keeping the rest", () => {
    const r = addFiles([], [file("video/webm", BUG_LIMITS.videoBytes + 1), file("image/jpeg", 100)]);
    expect(r.add.map((f) => f.type)).toEqual(["image/jpeg"]);
    expect(r.problem).toMatch(/Videos must be under 5 MB; this one is 5 MB/);
  });
  it("refuses a second video and a seventh screenshot", () => {
    expect(addFiles([file("video/mp4", 10)], [file("video/mp4", 10)]).problem).toMatch(/One video/);
    const six = Array.from({ length: BUG_LIMITS.images }, () => file("image/png", 10));
    const r = addFiles(six, [file("image/png", 10)]);
    expect(r.add).toEqual([]);
    expect(r.problem).toMatch(/Up to 6 screenshots/);
  });
  it("refuses other file types", () => {
    expect(addFiles([], [file("application/pdf", 10)]).problem).toMatch(/Only images/);
    expect(addFiles([], [file("image/svg+xml", 10)]).problem).toMatch(/Only images/);
  });
});

describe("deviceOf", () => {
  it("names the browser and system", () => {
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on Windows");
    expect(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(deviceOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
  });
});
