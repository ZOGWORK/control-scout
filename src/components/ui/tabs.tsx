// Ported from Control Point (src/components/ui-kit/tabs.tsx) — same component, same tokens, so the two apps feel like family.
// shadcn/ui Tabs on Radix, mapped to Control Point tokens. The active tab is
// filled with the team accent, matching the existing segmented controls.
import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '../cn';

export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('inline-flex w-full sm:w-fit items-center gap-1 rounded-2xl border border-line bg-secondary p-1 overflow-x-auto custom-scrollbar', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // When the list scrolls sideways (phones), keep the selected tab in view —
  // e.g. an upcoming event that opens on its last tab.
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    const el = ref.current, list = el?.parentElement;
    if (!el || !list || el.dataset.state !== 'active' || list.scrollWidth <= list.clientWidth) return;
    if (el.offsetLeft < list.scrollLeft || el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollLeft = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
    }
  });
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex flex-1 sm:flex-none items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 sm:px-4 py-2 text-sm font-bold',
        'text-text-muted transition-colors hover:text-text-base outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'data-[state=active]:bg-accent data-[state=active]:text-accent-ink disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('outline-none min-w-0', className)} {...props} />;
}
