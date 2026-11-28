// Clips' own mark: two tall cards, the one behind tipped as if just swiped away, a play notch in the front one. Its own
// shape, not FIRST's or YouTube's. `mono` draws it in the current colour as an outline, the weight of the nav's other
// icons (lucide's 2px strokes); otherwise it's filled in the accent, for the Clips name on the page and the Videos row.
import { cn } from "../cn";

export function ClipsMark({ className, mono }: { className?: string; mono?: boolean }) {
  if (mono) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn("size-6 shrink-0", className)} data-clips-mark>
        <path d="M10.5 3.2 16.6 2a2.4 2.4 0 0 1 2.8 1.9l2.4 12.3a2.4 2.4 0 0 1-1.6 2.7" />
        <rect x="3" y="5" width="12.5" height="17" rx="2.6" />
        <path d="m7.6 10.3 4 2.9-4 2.9z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-6 shrink-0", className)} data-clips-mark>
      <rect x="8.2" y="1.4" width="12.5" height="17.4" rx="3" transform="rotate(12 14.45 10.1)" className="fill-accent opacity-45" />
      <rect x="2.8" y="4.8" width="12.8" height="17.6" rx="3" className="fill-accent" />
      <path d="M7.3 10.1c0-.6.6-.9 1.1-.6l4.3 2.9c.4.3.4.9 0 1.2l-4.3 2.9c-.5.3-1.1 0-1.1-.6z" className="fill-accent-ink" />
    </svg>
  );
}

/** The Clips name: the mark and the word, in the same face and weight as "Control Scout" in the sidebar. */
export function ClipsWordmark({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-display text-2xl font-bold tracking-tight", className)} data-clips-wordmark>
      <ClipsMark className={cn("size-8", markClassName)} />
      Clips
    </span>
  );
}

/** The mark as a nav icon (the sidebar, the menu sheet and the tab bar take an icon component). */
export const ClipsIcon = ({ className }: { className?: string }) => <ClipsMark mono className={className} />;
