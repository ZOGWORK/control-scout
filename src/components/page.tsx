// Ported from Control Point (src/modern/ui/page.tsx), plus loading / error states.
// Page-level compositions for Modern screens (built from the shadcn kit):
// one PageHeader per page, Sections separated by headings + hairlines, and
// consistent empty / error states.
import type { ComponentType, ReactNode } from 'react';
import { cn } from './cn';
import { Reveal } from './motion';

/** Page body: max width 1200 (unless fullBleed), brief's gutters. */
export function Page({ children, className, fullBleed }: { children: ReactNode; className?: string; fullBleed?: boolean }) {
  return (
    <div className={cn('w-full', !fullBleed && 'mx-auto max-w-[1200px] min-[1700px]:max-w-[1600px]', className)}>{children}</div>
  );
}

export function PageHeader({ title, description, phoneDescription, actions, eyebrow, children }: {
  title: ReactNode;
  description?: ReactNode;
  /**
   * A one-line intro for phones (under 768px), in place of `description`. Giving one also tightens the header
   * there (no eyebrow, smaller gaps), so a list page's first results fit in the first view.
   */
  phoneDescription?: ReactNode;
  /** Primary action (+ overflow) on the right. */
  actions?: ReactNode;
  /** Small line above the title (e.g. a date). */
  eyebrow?: ReactNode;
  /** Tabs or filters under the title. */
  children?: ReactNode;
}) {
  // No fade-in: the title and description are the page's main content, so they paint at full
  // opacity on the first frame (replacing the static first paint). A page change fades the whole page (Shell).
  const tight = phoneDescription != null;
  return (
    <div className={cn("mb-8", tight && "max-md:mb-3")}>
      <div className={cn("flex flex-wrap items-end justify-between gap-4", tight && "max-md:gap-2")}>
        <div className="min-w-0">
          {eyebrow && <p className={cn("mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground", tight && "max-md:hidden")}>{eyebrow}</p>}
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-[32px] sm:leading-tight">{title}</h1>
          {description && <p className={cn("mt-1.5 max-w-2xl text-sm text-muted-foreground", tight && "max-md:hidden")}>{description}</p>}
          {tight && <p className="mt-0.5 truncate text-sm text-muted-foreground md:hidden">{phoneDescription}</p>}
        </div>
        {actions && <div data-print-hide className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className={cn("mt-6", tight && "max-md:mt-3")}>{children}</div>}
    </div>
  );
}

export function Section({ title, description, action, stackAction = false, children, className, delay = 0 }: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Below the sm breakpoint, put the action under the title and description instead of beside them (a long description would otherwise be squeezed into a narrow column). */
  stackAction?: boolean;
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <Reveal delay={delay} className={cn('mb-8', className)}>
      <section>
        {(title || action) && (
          <div className={cn('mb-4 flex items-end justify-between gap-3 border-b border-border pb-3', stackAction && 'max-sm:flex-col max-sm:items-start')}>
            <div className="min-w-0">
              {title && <h2 className="text-base font-semibold text-foreground">{title}</h2>}
              {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
            </div>
            {action && <div className="shrink-0">{action}</div>}
          </div>
        )}
        {children}
      </section>
    </Reveal>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon?: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center', className)}>
      {Icon && (
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" />
        </span>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A single metric: label, large value, optional hint. Used inside a stat row. */
export function Stat({ label, value, hint, tone, icon: Icon, onClick }: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'good' | 'bad';
  icon?: ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  const Comp: any = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'group min-w-0 text-left',
        onClick && 'rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
      )}
    >
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
        {Icon && <Icon className="size-4" />}
        {label}
      </p>
      <p className={cn(
        'mt-1 font-display text-3xl font-semibold tabular-nums tracking-tight',
        tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-foreground',
      )}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Comp>
  );
}
