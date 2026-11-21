// Ported from Control Point (src/components/ui-kit/button.tsx) — same component, same tokens, so the two apps feel like family.
// shadcn/ui Button, mapped to Control Point tokens:
//   shadcn primary  -> our accent (per-team colour) with accent-ink text
//   shadcn accent   -> a neutral text-base tint (hover fills)
import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

export const buttonVariants = cva(
  // Exact properties (never transition-all) and the 0.97 press on a strong ease-out; no shrink under reduced motion.
  // v8 (docs/design/v8-revamp-brief.md §5): 8px corners, and no coloured button anywhere.
  'inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl v8:rounded-lg text-sm font-semibold ' +
    'transition-[color,background-color,border-color,box-shadow,opacity,scale] duration-150 ease-out ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 ' +
    "[&_svg:not([class*='size-']):not([class*='w-']):not([class*='h-'])]:size-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 " +
    // tap-44: rem sizes shrink with a phone's 14px base (h-8 is 28px there), so touch screens get a 44px tap area.
    'focus-visible:ring-offset-2 focus-visible:ring-offset-primary tap-44',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-ink font-bold shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] hover:brightness-105 ' +
          // v8 primary (Q2): white text on a faint white fill with a hairline, at most one per screen.
          'v8:bg-ink/10 v8:text-text-base v8:font-semibold v8:shadow-none v8:ring-1 v8:ring-inset v8:ring-ink/[0.12] v8:hover:bg-ink/[0.14] v8:hover:brightness-100',
        // Secondary and outline carry their own edge and a faint fill, so they read as buttons on any surface:
        // the hairline (border-line, 8% white on dark) vanished on a card. Secondary (e.g. "Tracking") is the
        // filled, pressed-looking one; outline the lighter one beside it.
        secondary: 'bg-text-base/[0.1] text-text-base border border-text-base/20 hover:bg-text-base/[0.14] active:bg-text-base/[0.18] v8:bg-ink/[0.06] v8:border-ink/10',
        outline: 'border border-text-base/25 bg-text-base/[0.05] text-text-base hover:bg-text-base/[0.09] hover:border-text-base/35 active:bg-text-base/[0.12] v8:border-ink/[0.12] v8:bg-transparent v8:hover:bg-ink/[0.06]',
        ghost: 'text-text-muted hover:text-text-base hover:bg-text-base/[0.06] v8:text-text-base v8:font-medium',
        destructive: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25 v8:bg-transparent v8:border-transparent v8:hover:bg-danger/10',
        link: 'text-accent-text underline-offset-4 hover:underline px-0 active:scale-100 v8:text-text-base',
      },
      // Sizes are rem: on a phone (14px base, src/index.css) default is 35px
      // and icon 35px to look at; the tap area is 44px on a touch screen (tap-44 above).
      size: {
        default: 'h-10 px-4',
        sm: 'h-8 rounded-lg px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'size-10',
        'icon-sm': 'size-8 rounded-lg',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends React.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
