// Ported from Control Point (src/modern/ui/motion.tsx).
// Motion primitives for Modern pages (motion/react). Reveal on mount, stagger
// lists, and animate numbers. Everything respects prefers-reduced-motion via
// the MotionConfig in ModernShell.
//
// The app's `m` elements come from here, not from motion/react (motion.test.tsx checks): until the
// animation features are here, each draws at rest (initial={false}), so nothing can stay stuck at a hidden
// `initial` state if they never arrive (audit V4-RUNTIME-001).
import { createElement, useContext, useEffect, type ComponentType, type ReactNode } from 'react';
import { LazyMotion, m as motionM, type FeatureBundle, type HTMLMotionProps, type Variants } from 'motion/react';
import { MotionReady, loadMotionFeatures, useMotionSupport } from '../lib/motionSupport';

const atRest = new Map<string, ComponentType<Record<string, unknown>>>();

/** motion's `m`, except that an element mounting before the animation features have arrived starts at rest. */
export const m = new Proxy(motionM, {
  get(target, key, receiver) {
    const Base = Reflect.get(target, key, receiver) as ComponentType<Record<string, unknown>> | undefined;
    if (typeof key !== 'string' || key === 'create' || !Base) return Base;
    let Element = atRest.get(key);
    if (!Element) {
      // React 19 passes `ref` as a prop, so it reaches the motion element with the rest.
      Element = function AtRestUntilReady(props: Record<string, unknown>) {
        const ready = useContext(MotionReady);
        return createElement(Base, ready ? props : { ...props, initial: false });
      };
      Element.displayName = `m.${key}`;
      atRest.set(key, Element);
    }
    return Element;
  },
}) as typeof motionM;

/** No features yet: motion elements render, but can't animate. */
const NO_FEATURES = {} as FeatureBundle;

/** Loads the animation features after first paint (src/lib/motionSupport.ts) and tells every `m` element whether
 *  they're here. strict: a full `motion.` element anywhere is an error. */
export function MotionFeatures({ children }: { children: ReactNode }) {
  const { features } = useMotionSupport();
  useEffect(() => { void loadMotionFeatures(); }, []);
  return (
    <LazyMotion features={features ?? NO_FEATURES} strict>
      <MotionReady.Provider value={features !== null}>{children}</MotionReady.Provider>
    </LazyMotion>
  );
}

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

