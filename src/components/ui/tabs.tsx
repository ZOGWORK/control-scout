// Ported from Control Point (src/components/ui-kit/tabs.tsx) — same component, same tokens, so the two apps feel like family.
// shadcn/ui Tabs on Radix, mapped to Control Point tokens. The active tab is
// filled with the team accent, matching the existing segmented controls.
import * as React from 'react';
import { smoothBehavior } from '../../lib/pageScroll';
import { scrollStripTo, stopStripGlide } from '../../lib/revealInStrip';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '../cn';

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

/** Which ends of a sideways-scrolling strip have more behind them: "start", "end", "both", or undefined when it all fits. */
export function stripFade(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): "start" | "end" | "both" | undefined {
  const more = el.scrollWidth - el.clientWidth;
  if (more <= 1) return undefined;
  const start = el.scrollLeft > 1, end = el.scrollLeft < more - 1;
  return start && end ? 'both' : start ? 'start' : end ? 'end' : undefined;
}

export function TabsList({ className, ref, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  // On a phone the strip scrolls sideways: fade the edge that has more tabs behind it (data-fade, .tabs-fade in
  // src/index.css), so a cut-off "Playoffs" reads as "there's more this way" rather than the end of the bar.
  const own = React.useRef<HTMLDivElement | null>(null);
  const [fade, setFade] = React.useState<ReturnType<typeof stripFade>>();
  React.useEffect(() => {
    const el = own.current;
    if (!el) return;
    const update = () => setFade(stripFade(el));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', update); ro?.disconnect(); };
  }, []);
  const setRef = React.useCallback((el: HTMLDivElement | null) => {
    own.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  }, [ref]);
  return (
    <TabsPrimitive.List
      ref={setRef}
      data-slot="tabs-list"
      data-fade={fade}
      className={cn('tabs-fade inline-flex w-full sm:w-fit items-center gap-1 max-sm:gap-1 rounded-2xl max-sm:rounded-xl border border-text-base/15 bg-text-base/[0.03] p-1 max-sm:p-1 overflow-x-auto custom-scrollbar', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // When the list scrolls sideways (phones), keep the selected tab in view —
  // e.g. an upcoming event that opens on its last tab.
  // It jumps there on arrival and glides when the reader picks another tab (instant under reduced motion).
  const ref = React.useRef<HTMLButtonElement>(null);
  const shown = React.useRef(false);
  React.useEffect(() => {
    const el = ref.current, list = el?.parentElement;
    const first = !shown.current;
    shown.current = true;
    if (!el || !list || el.dataset.state !== 'active' || list.scrollWidth <= list.clientWidth) return;
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      scrollStripTo(list, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2, first ? 'auto' : smoothBehavior());
    } else {
      // Already showing: a glide still heading for the tab just left stops here (src/lib/revealInStrip.ts).
      stopStripGlide(list);
    }
  });
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl max-sm:rounded-lg px-2.5 sm:px-4 py-1.5 sm:py-2 text-sm font-bold',
        // Inactive tabs are pills of their own (a faint fill and edge), so each reads as something to tap.
        'border border-text-base/10 bg-text-base/[0.05] text-text-base/80 transition-colors hover:bg-text-base/[0.1] hover:text-text-base outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'data-[state=active]:border-transparent',
        'data-[state=active]:bg-accent data-[state=active]:text-accent-ink disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  // No outline-none: Radix makes the panel a tab stop, and a keyboard user reaching it sees the shared :focus-visible ring.
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('min-w-0', className)} {...props} />;
}
