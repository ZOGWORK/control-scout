// Ported from Control Point (src/components/ui-kit/button.tsx) — same component, same tokens, so the two apps feel like family.
// shadcn/ui Button, mapped to Control Point tokens:
//   shadcn primary  -> our accent (per-team colour) with accent-ink text
//   shadcn accent   -> a neutral text-base tint (hover fills)
import * as React from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all ' +
    'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:pointer-events-none [&_svg]:shrink-0 ' +
    "[&_svg:not([class*='size-']):not([class*='w-']):not([class*='h-'])]:size-4 outline-none focus-visible:ring-2 focus-visible:ring-accent/60 " +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-primary',
  {
    variants: {
      variant: {
        default: 'bg-accent text-accent-ink font-bold shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] hover:brightness-105',
        // Secondary and outline carry their own edge and a faint fill, so they read as buttons on any surface:
        // the hairline (border-line, 8% white on dark) vanished on a card. Secondary (e.g. "Tracking") is the
        // filled, pressed-looking one; outline the lighter one beside it.
        secondary: 'bg-text-base/[0.1] text-text-base border border-text-base/20 hover:bg-text-base/[0.14] active:bg-text-base/[0.18]',
        outline: 'border border-text-base/25 bg-text-base/[0.05] text-text-base hover:bg-text-base/[0.09] hover:border-text-base/35 active:bg-text-base/[0.12]',
        ghost: 'text-text-muted hover:text-text-base hover:bg-text-base/[0.06]',
        destructive: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
        link: 'text-accent-text underline-offset-4 hover:underline px-0 active:scale-100',
      },
      // Sizes are rem: on a phone (14px base, src/index.css) default is 35px
      // and icon 35px, still well past the 24px minimum touch target.
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
