// Motion's animation features (layout and gestures included), loaded after first paint by the LazyMotion in
// main.tsx: the app's components are motion's lightweight `m` elements, so the feature code stays off the
// first download. Everything still renders before this arrives; it only animates once it has.
export { domMax as default } from "motion/react";
