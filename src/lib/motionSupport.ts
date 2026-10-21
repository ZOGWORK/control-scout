// Motion's animation features are an optional download (audit V4-RUNTIME-001). They arrive after first paint
// (src/lib/motionFeatures.ts); until then, and for good if the download fails, motion elements can't animate.
// An element that mounts without them keeps whatever it first drew, so src/components/motion.tsx's `m` draws
// it at rest (its `animate` state, never a hidden `initial` one) whenever the features aren't here.
//
// A failed download is handled here, not left as an unhandled rejection. It isn't a page's own code, so it never
// offers the page reload that src/lib/chunkError.ts offers for those: the app just stays still until the next full
// load. No retry: Chromium keeps a failed dynamic import in its module map, so importing again never refetches.
import { createContext, useSyncExternalStore } from "react";
import type { FeatureBundle } from "motion/react";

export type MotionSupport = {
  /** The loaded features, or null: not here yet, or the download failed. */
  features: FeatureBundle | null;
  /** The download failed: this page load stays without animation. */
  failed: boolean;
};

let state: MotionSupport = { features: null, failed: false };
let started: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (next: MotionSupport) => { state = next; for (const l of listeners) l(); };

/** The download itself (replaceable in tests). */
export const motionLoader = { load: (): Promise<FeatureBundle> => import("./motionFeatures").then((r) => r.default) };

/** Fetch the features, once per page load. Never rejects. */
export function loadMotionFeatures(): Promise<void> {
  started ??= motionLoader.load().then(
    (features) => { set({ features, failed: false }); },
    () => { set({ features: null, failed: true }); },
  );
  return started;
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
export const useMotionSupport = (): MotionSupport => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Whether motion elements may start from their `initial` state: true only once the features are here. Outside the
 *  app's provider (unit tests) it's true, so components render exactly as motion draws them. */
export const MotionReady = createContext(true);

/** Back to a fresh page load (tests only). */
export function resetMotionSupportForTests(): void {
  state = { features: null, failed: false };
  started = null;
}
