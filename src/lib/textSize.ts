// Text size: how big everything is drawn on this device. Sizes across the app are in rem, so one root font
// size scales text, spacing, boxes and buttons together, with nothing hidden or moved. Phones start a step
// smaller than desktop (14 px instead of 16: more fits before you scroll, src/index.css); on top of that
// each device picks Smaller, Default, Larger or Largest in Settings › Appearance. Kept on this device
// (a phone and a laptop want different sizes), applied before first paint by index.html's head script.
import { useSyncExternalStore } from "react";

export type TextSize = "s" | "m" | "l" | "xl";
export const TEXT_SIZES: { id: TextSize; label: string }[] = [
  { id: "s", label: "Smaller" },
  { id: "m", label: "Default" },
  { id: "l", label: "Larger" },
  { id: "xl", label: "Largest" },
];
export const TEXT_SIZE_KEY = "cs-text-size";
const CHANGED = "cs-text-size-changed";

export const isTextSize = (v: unknown): v is TextSize => v === "s" || v === "m" || v === "l" || v === "xl";

/** Put the size on <html> (data-text-size; Default is no attribute, so the stylesheet's own sizes stand). */
export function applyTextSize(size: TextSize, root: HTMLElement = document.documentElement): void {
  if (size === "m") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", size);
}

// With storage blocked (a private window), a choice still holds for this visit.
let visitOnly: TextSize | null = null;

function read(): TextSize {
  try { const v = localStorage.getItem(TEXT_SIZE_KEY); return isTextSize(v) ? v : "m"; } catch { return visitOnly ?? "m"; }
}

export function setTextSize(size: TextSize): void {
  try { if (size === "m") localStorage.removeItem(TEXT_SIZE_KEY); else localStorage.setItem(TEXT_SIZE_KEY, size); } catch { /* storage blocked: this visit only */ visitOnly = size; }
  applyTextSize(size);
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === TEXT_SIZE_KEY || e.key === null) { applyTextSize(read()); fn(); } };
  window.addEventListener(CHANGED, fn);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(CHANGED, fn); window.removeEventListener("storage", onStorage); };
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, read, () => "m");
}
