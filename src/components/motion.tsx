// Ported from Control Point (src/modern/ui/motion.tsx).
// Motion primitives for Modern pages (motion/react). Reveal on mount, stagger
// lists, and animate numbers. Everything respects prefers-reduced-motion via
// the MotionConfig in ModernShell.
import { m, type HTMLMotionProps, type Variants } from 'motion/react';

const ease = [0.2, 0.8, 0.2, 1] as const;

/**
 * Fades + rises in on mount. `fade={false}` keeps the rise but paints the
 * content at full opacity from the first frame: use it on a page's hero,
 * whose big text is the Largest Contentful Paint. Chrome ignores text under
 * opacity 0, and a compositor-driven fade means LCP only lands once the fade
 * has finished (seconds later on a throttled phone).
 */
export function Reveal({ delay = 0, y = 8, fade = true, ...props }: HTMLMotionProps<'div'> & { delay?: number; y?: number; fade?: boolean }) {
  return (
    <m.div
      initial={{ opacity: fade ? 0 : 1, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease, delay }}
      {...props}
    />
  );
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease } },
};

/** Parent that staggers its <StaggerItem> children in. */
export function Stagger({ as = 'div', ...props }: HTMLMotionProps<'div'> & { as?: 'div' | 'ul' | 'ol' }) {
  const C = as === 'ul' ? m.ul : as === 'ol' ? m.ol : m.div;
  return <C variants={container} initial="hidden" animate="show" {...(props as any)} />;
}
export function StaggerItem({ as = 'div', ...props }: HTMLMotionProps<'div'> & { as?: 'div' | 'li' }) {
  const C = as === 'li' ? m.li : m.div;
  return <C variants={item} {...(props as any)} />;
}

export { m };
