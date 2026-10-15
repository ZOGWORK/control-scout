// The filter builder's and the column picker's home: a side panel docked on the right (under the top bar)
// that leaves the page usable, not a dialog over it. The page's scroll area (#main) narrows to make room
// on wide screens, so the table stays in view next to it; on phones it's a sheet over the lower part of
// the screen. No backdrop, no focus trap: Esc or × closes it, and focus goes back where it came from.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useMediaQuery } from "../../lib/meta";
import { cn } from "../cn";

/** Width of the docked panel (also the room #main makes for it). */
export const PANEL_WIDTH = "min(30rem, 42vw)";

export function Panel({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const phone = useMediaQuery("(max-width: 639px)");
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const close = useRef(onOpenChange);
  close.current = onOpenChange;

  // Focus in on open, back to the button that opened it on close; Esc closes.
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("input, button:not([data-close]), [tabindex]")?.focus());
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) close.current(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  // Wide screens: the page makes room so nothing sits under the panel.
  useEffect(() => {
    const main = document.getElementById("main");
    if (!open || phone || !main) return;
    main.style.paddingRight = PANEL_WIDTH;
    return () => { main.style.paddingRight = ""; };
  }, [open, phone]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div ref={box} role="dialog" aria-modal="false" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined}
      className={cn("fixed z-40 flex flex-col gap-3 border-line bg-card p-4 shadow-[0_0_32px_-8px_rgb(0_0_0/0.6)]",
        phone ? "inset-x-0 bottom-0 h-[72dvh] rounded-t-2xl border-t pt-5" : "bottom-0 right-0 top-12 border-l",
        className)}
      style={phone ? undefined : { width: PANEL_WIDTH }}>
      {phone && <div aria-hidden className="mx-auto -mt-2 h-1 w-10 shrink-0 rounded-full bg-text-base/20" />}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`${id}-t`} className="font-display text-lg font-semibold">{title}</h2>
          {description && <p id={`${id}-d`} className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        <button type="button" data-close onClick={() => onOpenChange(false)} aria-label="Close panel"
          className="grid size-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-text-base/[0.06] hover:text-text-base max-sm:size-10">
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer && <div className="shrink-0 border-t border-line pt-3">{footer}</div>}
    </div>,
    document.body,
  );
}
