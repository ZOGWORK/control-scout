// One first-run surface at a time. A first visit can trigger several "hello"
// surfaces (the onboarding tour, the add-to-home-screen nudge, …); stacking
// them is noise, so each one asks for the single slot here before it shows and
// gives it back when it closes. Whoever asks first gets it; the others wait
// (useFirstRunSlot re-asks when the slot frees). The privacy banner is not a
// first-run surface: it comes before all of them (they wait for the consent
// choice themselves), and error prompts are never held back.
import { useEffect, useState, useSyncExternalStore } from "react";

let holder: string | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of [...listeners]) l(); };

/** Take the slot for `id`. True when it's now (or already was) `id`'s. */
export function claimFirstRun(id: string): boolean {
  if (holder && holder !== id) return false;
  if (holder !== id) { holder = id; emit(); }
  return true;
}

/** Give the slot back (only its holder can). */
export function releaseFirstRun(id: string): void {
  if (holder !== id) return;
  holder = null;
  emit();
}

/** Who has the slot right now (null: free). */
export function firstRunHolder(): string | null { return holder; }

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

/** The slot's holder, as React state. */
export function useFirstRunHolder(): string | null {
  return useSyncExternalStore(subscribe, firstRunHolder, () => null);
}

/**
 * While `want` is true, hold the slot for `id` as soon as it's free; true while held.
 * Released when `want` turns false or the component unmounts.
 */
export function useFirstRunSlot(id: string, want: boolean): boolean {
  const current = useFirstRunHolder();
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!want) { setHeld(false); releaseFirstRun(id); return; }
    if (current === null || current === id) setHeld(claimFirstRun(id));
    else setHeld(false);
  }, [want, current, id]);
  useEffect(() => () => releaseFirstRun(id), [id]);
  return held && want;
}

/** Tests only. */
export function resetFirstRunForTests(): void { holder = null; emit(); }
