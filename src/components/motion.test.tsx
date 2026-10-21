// @vitest-environment jsdom
// Audit V4-RUNTIME-001: the animation features are optional. While they're on their way, and for good if their
// download fails, `m` elements draw at rest (never stuck at a hidden `initial` state); the failure is handled.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { domMax, type FeatureBundle } from "motion/react";
import { MotionFeatures, m } from "./motion";
import { loadMotionFeatures, motionLoader, resetMotionSupportForTests, useMotionSupport } from "../lib/motionSupport";

const realLoad = motionLoader.load;
beforeEach(() => { resetMotionSupportForTests(); });
afterEach(() => { cleanup(); motionLoader.load = realLoad; });

/** A download we settle by hand. */
function controlled() {
  let resolve!: (f: FeatureBundle) => void, reject!: (e: unknown) => void;
  const promise = new Promise<FeatureBundle>((res, rej) => { resolve = res; reject = rej; });
  const load = vi.fn(() => promise);
  motionLoader.load = load;
  return { load, resolve, reject };
}

const Fading = ({ id }: { id: string }) => <m.div data-testid={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} />;
const opacity = (id: string) => screen.getByTestId(id).style.opacity;

function Status() {
  const { features, failed } = useMotionSupport();
  return <p data-testid="status">{features ? "ready" : failed ? "failed" : "loading"}</p>;
}

describe("optional animation features", () => {
  it("draws elements at rest while the features are on their way", () => {
    controlled();
    render(<MotionFeatures><Fading id="a" /></MotionFeatures>);
    expect(opacity("a")).toBe("1");
  });

  it("handles a failed download: no rejection, and pages mounted after it are visible too", async () => {
    const dl = controlled();
    const view = render(<MotionFeatures><Status /><Fading id="before" /></MotionFeatures>);
    await act(async () => { dl.reject(new TypeError("Failed to fetch dynamically imported module: /assets/motionFeatures-x.js")); });
    expect(screen.getByTestId("status").textContent).toBe("failed");
    // The next page: mounted after the failure.
    view.rerender(<MotionFeatures><Status /><Fading id="before" /><Fading id="after" /></MotionFeatures>);
    expect(opacity("before")).toBe("1");
    expect(opacity("after")).toBe("1");
    await expect(loadMotionFeatures()).resolves.toBeUndefined(); // settled, never rejects
  });

  it("downloads once per page load", async () => {
    const dl = controlled();
    void loadMotionFeatures();
    void loadMotionFeatures();
    render(<MotionFeatures><Fading id="a" /></MotionFeatures>);
    await act(async () => { dl.resolve(domMax); });
    expect(dl.load).toHaveBeenCalledTimes(1);
  });

  it("once the features are here, new elements start from `initial` and animate as before", async () => {
    const dl = controlled();
    const view = render(<MotionFeatures><Status /></MotionFeatures>);
    await act(async () => { dl.resolve(domMax); });
    expect(screen.getByTestId("status").textContent).toBe("ready");
    view.rerender(<MotionFeatures><Status /><Fading id="late" /></MotionFeatures>);
    expect(opacity("late")).toBe("0");
  });

  it("passes refs through to the element", () => {
    controlled();
    let node: HTMLElement | null = null;
    render(<MotionFeatures><m.section ref={(el: HTMLElement | null) => { node = el; }} data-testid="s" /></MotionFeatures>);
    expect(node).toBe(screen.getByTestId("s"));
  });
});

describe("every `m` element goes through components/motion.tsx", () => {
  const root = join(process.cwd(), "src");
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []);

  it("imports `m` from motion/react nowhere else", () => {
    const own = join(root, "components", "motion.tsx");
    const offenders = sources(root).filter((f) => f !== own && /import\s*\{[^}]*\bm\b[^}]*\}\s*from\s*["']motion\/react["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});
