// @vitest-environment jsdom
// The loader that requests the app's code after the first paint (server/seo.ts afterFirstPaint).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint } from "./seo";

const HTML = '<html><head><script type="module" crossorigin src="/assets/index-a.js"></script><link rel="modulepreload" crossorigin href="/assets/v.js"></head><body></body></html>';
const loader = () => /<script>(\(function\(\)[\s\S]*?)<\/script>/.exec(afterFirstPaint(HTML))![1];
const added = () => [...document.head.children].map((e) => `${e.tagName}:${e.getAttribute("src") ?? e.getAttribute("href")}`);

beforeEach(() => { vi.useFakeTimers(); document.head.innerHTML = ""; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.head.innerHTML = ""; });

describe("afterFirstPaint loader", () => {
  it("adds nothing before the first frame, then the preloads and the entry, once", () => {
    let frame: (() => void) | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => { frame = cb; return 1; });
    (0, eval)(loader());
    expect(added()).toEqual([]);
    frame!(); // the frame is being drawn: still nothing
    expect(added()).toEqual([]);
    vi.advanceTimersByTime(0); // the task after it
    expect(added()).toEqual(["LINK:/assets/v.js", "SCRIPT:/assets/index-a.js"]);
    const script = document.head.querySelector("script")!;
    expect(script.type).toBe("module");
    expect(script.crossOrigin).toBe("anonymous");
    vi.advanceTimersByTime(200); // the fallback timer adds nothing more
    expect(added()).toHaveLength(2);
  });

  it("a background tab (no frames) still loads the app", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    (0, eval)(loader());
    vi.advanceTimersByTime(100);
    expect(added()).toEqual(["LINK:/assets/v.js", "SCRIPT:/assets/index-a.js"]);
  });
});
