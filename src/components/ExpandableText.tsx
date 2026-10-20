// Long text clamped to two lines with a Show more / Show less toggle. Clamping is visual only: the whole
// text stays in the page for screen readers, search and copy. Short text renders as is, with no toggle.
import { useId, useState } from "react";
import { cn } from "./cn";

export function ExpandableText({ text, limit = 90, className, what = "text" }: {
  text: string;
  /** Longer than this many characters gets the toggle (about two lines on a phone). */
  limit?: number;
  className?: string;
  /** What the toggle reveals, for its accessible name ("Show more of the summary"). */
  what?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (text.length <= limit) return <p className={cn("[overflow-wrap:anywhere]", className)}>{text}</p>;
  return (
    <div className={className}>
      <p id={id} className={cn("[overflow-wrap:anywhere]", !open && "line-clamp-2")}>{text}</p>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        aria-label={`${open ? "Show less" : "Show more"} of the ${what}`}
        className="mt-0.5 inline-flex min-h-11 items-center text-xs font-medium text-accent-text underline-offset-2 hover:underline sm:min-h-6">
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
