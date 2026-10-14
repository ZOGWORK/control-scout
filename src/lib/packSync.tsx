// Keeps the lite pack on every device without asking: after the page goes
// idle (and on reconnect) it loads packs.ts lazily — the engine stays out of
// the entry bundle — and downloads the pack if it's missing or outdated.
import { useEffect } from "react";

export function LitePackSync(): null {
  useEffect(() => {
    const run = () => { void import("./packs").then((p) => p.syncLite()); };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 10_000 }) : window.setTimeout(run, 3000);
    window.addEventListener("online", run);
    return () => {
      if (w.cancelIdleCallback) w.cancelIdleCallback(id); else clearTimeout(id);
      window.removeEventListener("online", run);
    };
  }, []);
  return null;
}
